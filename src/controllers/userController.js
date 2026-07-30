const jwt = require("jsonwebtoken");
const User = require("../models/User");
const App = require("../models/App");
const Review = require("../models/Review");
const {
  getAuthorizeUrl,
  exchangeCodeForToken,
  getGithubUser,
} = require("../services/githubService");
const { JWT_SECRET } = require("../utils/jwt");
const { fileToDataUri } = require("../utils/imageEncoding");

/**
 * Aggregates a developer's stats across every app they've published:
 *  - totalDownloads: sum of each app's download counter
 *  - avgRating: the mean of each *rated* app's own average rating
 *    (e.g. 3 apps rated 4.0, 5.0 and 3.0 -> 4.0), matching how the
 *    profile/download screens describe it. Apps with no reviews yet
 *    don't drag this down or count toward it.
 */
async function loadDeveloperStats(userId) {
  const apps = await App.find({ developer: userId }).select("_id downloads");
  const totalDownloads = apps.reduce((sum, a) => sum + (a.downloads || 0), 0);
  const appIds = apps.map((a) => a._id);

  if (!appIds.length) {
    return { appsCount: 0, totalDownloads: 0, avgRating: 0, ratedAppsCount: 0 };
  }

  const rows = await Review.aggregate([
    { $match: { app: { $in: appIds } } },
    { $group: { _id: "$app", avgRating: { $avg: "$rating" } } },
  ]);

  const avgRating = rows.length
    ? Math.round((rows.reduce((sum, r) => sum + r.avgRating, 0) / rows.length) * 10) / 10
    : 0;

  return {
    appsCount: apps.length,
    totalDownloads,
    avgRating,
    ratedAppsCount: rows.length,
  };
}

async function withAppsCount(user) {
  const stats = await loadDeveloperStats(user._id);
  return { ...user.toPublicJSON(), ...stats };
}

/** GET /api/users/me — the logged in user's own profile. */
async function getMe(req, res) {
  res.json(await withAppsCount(req.user));
}

/**
 * GET /api/users/:username — any user's public profile.
 * Used for the "About the developer" section on the download screen so it
 * always reflects that developer's current name/photo/about, wherever
 * it's shown.
 */
async function getByUsername(req, res) {
  const user = await User.findOne({ username: req.params.username.toLowerCase() });
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json(await withAppsCount(user));
}

/**
 * PUT /api/users/me — edit name / username / about / photo.
 * Apps reference the developer by ObjectId and populate on read, so any
 * edit here is reflected everywhere (home feed, app details, etc.)
 * automatically — no need to touch existing App documents.
 */
async function updateMe(req, res) {
  try {
    const { name, username, about } = req.body;
    const user = req.user;

    if (name) user.name = name;
    if (about) user.about = about;

    if (username && username.toLowerCase() !== user.username) {
      const taken = await User.findOne({ username: username.toLowerCase() });
      if (taken) return res.status(409).json({ message: "That username is already taken" });
      user.username = username.toLowerCase();
    }

    if (req.file) {
      user.photo = fileToDataUri(req.file);
    }

    await user.save();
    res.json(await withAppsCount(user));
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    console.error("updateMe error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
}

/**
 * GET /api/users/me/github/connect — returns the URL the client should
 * open (browser/webview) to start the GitHub OAuth handshake. We sign the
 * user's id into a short-lived JWT and pass it as `state` so the callback
 * (which GitHub calls with no auth header of ours) knows who to attach
 * the resulting token to.
 */
function githubConnect(req, res) {
  const state = jwt.sign({ userId: req.user._id.toString() }, JWT_SECRET, {
    expiresIn: "15m",
  });
  res.json({ url: getAuthorizeUrl(state) });
}

/**
 * GET /api/users/github/callback — GitHub redirects here after the user
 * authorizes our app. Exchanges the code for a token, fetches the GitHub
 * username, and saves both on the matching user.
 */
async function githubCallback(req, res) {
  const { code, state } = req.query;

  try {
    const { userId } = jwt.verify(state, JWT_SECRET);
    const accessToken = await exchangeCodeForToken(code);
    const ghUser = await getGithubUser(accessToken);

    await User.findByIdAndUpdate(userId, {
      github: {
        connected: true,
        username: ghUser.login,
        accessToken,
      },
    });

    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 80px;">
          <h2>GitHub connected as @${ghUser.login} ✅</h2>
          <p>You can close this window and go back to SoftStore.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("githubCallback error:", err.message);
    res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 80px;">
          <h2>GitHub connection failed</h2>
          <p>${err.message}</p>
        </body>
      </html>
    `);
  }
}

/**
 * POST /api/users/me/fcm-token — call this once you have a device's FCM
 * registration token (after the user grants notification permission).
 * Body: { token: string }. Safe to call again with the same token.
 */
async function registerFcmToken(req, res) {
  const { token } = req.body;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ message: "token is required" });
  }
  await User.findByIdAndUpdate(req.user._id, { $addToSet: { fcmTokens: token } });
  res.json({ message: "Token registered" });
}

/**
 * DELETE /api/users/me/fcm-token — call this on logout (or whenever a
 * token is invalidated client-side) so this device stops receiving
 * push notifications for this account. Body: { token: string }.
 */
async function unregisterFcmToken(req, res) {
  const { token } = req.body;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ message: "token is required" });
  }
  await User.findByIdAndUpdate(req.user._id, { $pull: { fcmTokens: token } });
  res.json({ message: "Token removed" });
}

module.exports = {
  getMe,
  getByUsername,
  updateMe,
  githubConnect,
  githubCallback,
  registerFcmToken,
  unregisterFcmToken,
};
