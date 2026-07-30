const path = require("path");
const App = require("../models/App");
const Review = require("../models/Review");
const { publishAppRelease } = require("../services/githubService");
const notificationService = require("../services/notificationService");
const { formatBytes } = require("../utils/formatBytes");
const { toProxiedUrl, toProxiedUrls } = require("../utils/mediaUrl");
const { CATEGORIES } = require("../constants/categories");

/**
 * Looks up { avgRating, reviewsCount } for one or more app ids in a
 * single aggregation query, so list endpoints don't need one query per
 * app. Returns a Map keyed by the app id string.
 */
async function loadReviewStats(appIds) {
  if (!appIds.length) return new Map();
  const rows = await Review.aggregate([
    { $match: { app: { $in: appIds } } },
    {
      $group: {
        _id: "$app",
        avgRating: { $avg: "$rating" },
        reviewsCount: { $sum: 1 },
      },
    },
  ]);
  const map = new Map();
  for (const row of rows) {
    map.set(row._id.toString(), {
      avgRating: Math.round(row.avgRating * 10) / 10,
      reviewsCount: row.reviewsCount,
    });
  }
  return map;
}

/** Shapes an App document (with developer populated) for API responses. */
function toAppJSON(app, reviewStats) {
  const dev = app.developer;
  const stats = reviewStats?.get(app._id.toString()) || {
    avgRating: 0,
    reviewsCount: 0,
  };
  return {
    id: app._id,
    name: app.name,
    description: app.description,
    category: app.category,
    visibility: app.visibility,
    icon: toProxiedUrl(app.icon),
    screenshots: toProxiedUrls(app.screenshots),
    repoLink: app.repoLink,
    fileUrl: app.fileUrl,
    fileName: app.fileName,
    sizeBytes: app.sizeBytes,
    size: formatBytes(app.sizeBytes),
    downloads: app.downloads,
    avgRating: stats.avgRating,
    reviewsCount: stats.reviewsCount,
    createdAt: app.createdAt,
    developer: dev
      ? {
          id: dev._id,
          name: dev.name,
          username: dev.username,
          photo: dev.photo,
          verified: dev.verified,
        }
      : null,
  };
}

/**
 * POST /api/apps — create a new app listing.
 * Expects multipart/form-data: name, description, category, visibility?,
 * repoLink, icon (file), appFile (file), screenshots (files, up to 6).
 * All image/binary assets are pushed into the developer's own GitHub
 * repo as assets on a single release (via their connected OAuth token) —
 * nothing is stored on our own server, so this works fine on hosts with
 * an ephemeral filesystem like Render.
 */
async function createApp(req, res) {
  try {
    const { name, description, repoLink, category } = req.body;
    let { visibility } = req.body;
    // Sent from the "notify everyone about this app?" prompt shown at
    // publish time on the client. Comes through as a string on
    // multipart/form-data ("true"/"false"), so compare loosely.
    const notifyAllUsers =
      req.body.notifyAllUsers === "true" || req.body.notifyAllUsers === true;
    const iconFile = req.files?.icon?.[0];
    const appFile = req.files?.appFile?.[0];
    const screenshotFiles = req.files?.screenshots || [];

    if (!name || !description || !repoLink) {
      return res
        .status(400)
        .json({ message: "name, description and repoLink are all required" });
    }
    if (!category || !CATEGORIES.includes(category)) {
      return res.status(400).json({
        message: `category is required and must be one of: ${CATEGORIES.join(", ")}`,
      });
    }
    if (visibility && !["public", "private"].includes(visibility)) {
      return res.status(400).json({ message: "visibility must be public or private" });
    }
    visibility = visibility || "public";

    if (!iconFile) return res.status(400).json({ message: "icon image is required" });
    if (!appFile) return res.status(400).json({ message: "appFile (.apk or .zip) is required" });

    const developer = req.user;
    if (!developer.github?.connected || !developer.github?.accessToken) {
      return res.status(400).json({
        message:
          "Connect a GitHub account first (see GET /api/users/me/github/connect) — app files are stored in your GitHub repo.",
      });
    }

    const iconExt = path.extname(iconFile.originalname) || ".jpg";
    const iconUploadName = `icon-${Date.now()}${iconExt}`;
    const appUploadName = `${Date.now()}-${appFile.originalname}`;
    const screenshotUploads = screenshotFiles.map((file, index) => ({
      buffer: file.buffer,
      fileName: `screenshot-${Date.now()}-${index}${path.extname(file.originalname) || ".jpg"}`,
    }));

    const { iconUrl, fileUrl, screenshotUrls } = await publishAppRelease({
      accessToken: developer.github.accessToken,
      repoLink,
      iconBuffer: iconFile.buffer,
      iconFileName: iconUploadName,
      appBuffer: appFile.buffer,
      appFileName: appUploadName,
      screenshots: screenshotUploads,
      releaseNotes: `${description}\n\nPublished via SoftStore.`,
    });

    const app = await App.create({
      name,
      description,
      category,
      visibility,
      icon: iconUrl,
      screenshots: screenshotUrls,
      repoLink,
      fileUrl,
      fileName: appFile.originalname,
      sizeBytes: appFile.buffer.length,
      developer: developer._id,
    });

    await app.populate("developer");

    // Fire-and-forget: don't make the developer wait on a fan-out push
    // to every user before their upload finishes.
    if (notifyAllUsers) {
      notificationService
        .notifyAllUsers({
          title: "New app on SoftStore",
          body: `${developer.name} just published "${app.name}"`,
          data: { type: "new_app", appId: app._id.toString() },
          excludeUserId: developer._id,
        })
        .catch((err) => console.error("notifyAllUsers (new app) failed:", err.message));
    }

    res.status(201).json(toAppJSON(app));
  } catch (err) {
    console.error("createApp error:", err.message);
    res.status(500).json({ message: err.message || "Failed to create app" });
  }
}

/**
 * GET /api/apps?search=term&category=term — the home feed: every
 * *public* app from every user, newest first, optionally filtered by a
 * case-insensitive name match and/or an exact category match. This is
 * what powers the home screen's search box and category scroll.
 */
async function listApps(req, res) {
  const { search, category } = req.query;
  const filter = { visibility: "public" };
  if (search) filter.name = { $regex: search, $options: "i" };
  if (category) filter.category = category;

  const apps = await App.find(filter).sort({ createdAt: -1 }).populate("developer");
  const reviewStats = await loadReviewStats(apps.map((a) => a._id));
  res.json(apps.map((a) => toAppJSON(a, reviewStats)));
}

/** GET /api/apps/categories — the fixed list of category options. */
function listCategories(req, res) {
  res.json(CATEGORIES);
}

/** GET /api/apps/mine — every app uploaded by the logged-in user (public + private). */
async function myApps(req, res) {
  const apps = await App.find({ developer: req.user._id })
    .sort({ createdAt: -1 })
    .populate("developer");
  const reviewStats = await loadReviewStats(apps.map((a) => a._id));
  res.json(apps.map((a) => toAppJSON(a, reviewStats)));
}

/**
 * GET /api/apps/:id — single app detail, used by the download screen.
 * Public apps are visible to anyone; private apps are only visible to
 * the developer who published them.
 */
async function getApp(req, res) {
  const app = await App.findById(req.params.id).populate("developer");
  if (!app) return res.status(404).json({ message: "App not found" });

  if (app.visibility === "private") {
    const isOwner = req.user && app.developer._id.toString() === req.user._id.toString();
    if (!isOwner) return res.status(404).json({ message: "App not found" });
  }

  const reviewStats = await loadReviewStats([app._id]);
  res.json(toAppJSON(app, reviewStats));
}

/**
 * GET /api/apps/:id/download — bumps the download counter then redirects
 * the client straight to the file on GitHub, so we never proxy the bytes
 * ourselves.
 */
async function downloadApp(req, res) {
  const app = await App.findByIdAndUpdate(
    req.params.id,
    { $inc: { downloads: 1 } },
    { new: true }
  );
  if (!app) return res.status(404).json({ message: "App not found" });
  res.redirect(app.fileUrl);
}

/**
 * GET /api/apps/featured — the top 3 "featured" public apps.
 *
 * Ranking is a score, not a plain rating sort, because a raw average
 * would let an app with a single 5-star review outrank one with a 4.0
 * average backed by many ratings and downloads — exactly backwards from
 * what "featured" should mean.
 *
 *   score = avgRating * log10(reviewsCount + downloads + 1)
 *
 * The log term is a "confidence" multiplier: it grows with both how
 * many people rated the app and how many downloaded it, but with
 * diminishing returns so one viral app with huge download counts can't
 * dominate purely on volume — the rating itself still matters just as
 * much. Example: 5★ from 1 review + 5 downloads scores lower than
 * 4★ from 3 reviews + 10 downloads (3.9 vs 4.6), matching the intent
 * that more people vouching for an app should count for something.
 *
 * Apps with zero reviews can't be scored on rating at all, so they're
 * only used to pad the list out to 3 (ranked by downloads) if there
 * aren't yet 3 rated public apps — this keeps the endpoint useful on a
 * fresh/mostly-empty store instead of returning fewer than 3 results.
 */
async function featuredApps(req, res) {
  const apps = await App.find({ visibility: "public" }).populate("developer");
  if (!apps.length) return res.json([]);

  const reviewStats = await loadReviewStats(apps.map((a) => a._id));

  const scored = apps.map((app) => {
    const stats = reviewStats.get(app._id.toString()) || {
      avgRating: 0,
      reviewsCount: 0,
    };
    const score =
      stats.reviewsCount > 0
        ? stats.avgRating * Math.log10(stats.reviewsCount + app.downloads + 1)
        : 0;
    return { app, stats, score };
  });

  const rated = scored
    .filter((s) => s.stats.reviewsCount > 0)
    .sort((a, b) => b.score - a.score);
  const unrated = scored
    .filter((s) => s.stats.reviewsCount === 0)
    .sort((a, b) => b.app.downloads - a.app.downloads);

  const top3 = [...rated, ...unrated].slice(0, 3);

  res.json(top3.map(({ app }) => toAppJSON(app, reviewStats)));
}

/**
 * DELETE /api/apps/:id — removes an app listing. Only the developer who
 * published it can delete it. This only removes our DB record — the
 * actual release/assets stay on GitHub since that's the developer's own
 * repo, not something we manage.
 */
async function deleteApp(req, res) {
  const app = await App.findById(req.params.id);
  if (!app) return res.status(404).json({ message: "App not found" });

  if (app.developer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "You can only delete your own apps" });
  }

  await App.findByIdAndDelete(req.params.id);
  await Review.deleteMany({ app: req.params.id });
  res.json({ message: "App deleted", id: req.params.id });
}

module.exports = {
  createApp,
  listApps,
  listCategories,
  myApps,
  getApp,
  downloadApp,
  deleteApp,
  featuredApps,
  toAppJSON,
  loadReviewStats,
};
