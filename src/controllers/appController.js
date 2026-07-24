const path = require("path");
const App = require("../models/App");
const { publishAppRelease } = require("../services/githubService");
const { formatBytes } = require("../utils/formatBytes");

/** Shapes an App document (with developer populated) for API responses. */
function toAppJSON(app) {
  const dev = app.developer;
  return {
    id: app._id,
    name: app.name,
    description: app.description,
    icon: app.icon,
    repoLink: app.repoLink,
    fileUrl: app.fileUrl,
    fileName: app.fileName,
    sizeBytes: app.sizeBytes,
    size: formatBytes(app.sizeBytes),
    downloads: app.downloads,
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
 * Expects multipart/form-data: name, description, repoLink, icon (file),
 * appFile (file, .apk/.zip). Both files are pushed into the developer's
 * own GitHub repo as assets on a single release (via their connected
 * OAuth token) — nothing is stored on our own server, so this works fine
 * on hosts with an ephemeral filesystem like Render.
 */
async function createApp(req, res) {
  try {
    const { name, description, repoLink } = req.body;
    const iconFile = req.files?.icon?.[0];
    const appFile = req.files?.appFile?.[0];

    if (!name || !description || !repoLink) {
      return res
        .status(400)
        .json({ message: "name, description and repoLink are all required" });
    }
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

    const { iconUrl, fileUrl } = await publishAppRelease({
      accessToken: developer.github.accessToken,
      repoLink,
      iconBuffer: iconFile.buffer,
      iconFileName: iconUploadName,
      appBuffer: appFile.buffer,
      appFileName: appUploadName,
      releaseNotes: `${description}\n\nPublished via SoftStore.`,
    });

    const app = await App.create({
      name,
      description,
      icon: iconUrl,
      repoLink,
      fileUrl,
      fileName: appFile.originalname,
      sizeBytes: appFile.buffer.length,
      developer: developer._id,
    });

    await app.populate("developer");
    res.status(201).json(toAppJSON(app));
  } catch (err) {
    console.error("createApp error:", err.message);
    res.status(500).json({ message: err.message || "Failed to create app" });
  }
}

/**
 * GET /api/apps?search=... — the home feed: every app from every user,
 * newest first, optionally filtered by a case-insensitive name/description
 * match. This is what powers the home screen's search box.
 */
async function listApps(req, res) {
  const { search } = req.query;
  const filter = search
    ? { name: { $regex: search, $options: "i" } }
    : {};

  const apps = await App.find(filter).sort({ createdAt: -1 }).populate("developer");
  res.json(apps.map(toAppJSON));
}

/** GET /api/apps/mine — apps uploaded by the logged-in user. */
async function myApps(req, res) {
  const apps = await App.find({ developer: req.user._id })
    .sort({ createdAt: -1 })
    .populate("developer");
  res.json(apps.map(toAppJSON));
}

/** GET /api/apps/:id — single app detail, used by the download screen. */
async function getApp(req, res) {
  const app = await App.findById(req.params.id).populate("developer");
  if (!app) return res.status(404).json({ message: "App not found" });
  res.json(toAppJSON(app));
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
  res.json({ message: "App deleted", id: req.params.id });
}

module.exports = { createApp, listApps, myApps, getApp, downloadApp, deleteApp };
