const fs = require("fs");
const path = require("path");
const App = require("../models/App");
const User = require("../models/User");
const { uploadReleaseAsset } = require("../services/githubService");
const { formatBytes } = require("../utils/formatBytes");
const { UPLOADS_ROOT } = require("../middleware/upload");

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
 * appFile (file, .apk/.zip). The appFile is pushed into the developer's
 * own GitHub repo (via their connected OAuth token) instead of being
 * stored on our server — GitHub's raw content URL becomes fileUrl.
 */
async function createApp(req, res) {
  try {
    const { name, description, repoLink } = req.body;
    const iconFile = req.files?.icon?.[0];
    const appFile = req.files?.appFile?.[0];

    if (!name || !description || !repoLink) {
      return res.status(400).json({
        message: "name, description and repoLink are all required",
      });
    }

    if (!iconFile)
      return res.status(400).json({ message: "icon image is required" });

    if (!appFile)
      return res.status(400).json({ message: "appFile is required" });

    const developer = req.user;

    if (!developer.github?.connected || !developer.github?.accessToken) {
      return res.status(400).json({
        message: "Connect your GitHub account first.",
      });
    }

    const iconDir = path.join(UPLOADS_ROOT, "icons");
    if (!fs.existsSync(iconDir))
      fs.mkdirSync(iconDir, { recursive: true });

    const iconExt = path.extname(iconFile.originalname) || ".jpg";
    const iconFilename =
      `${Date.now()}-${Math.round(Math.random() * 1e9)}${iconExt}`;

    fs.writeFileSync(
      path.join(iconDir, iconFilename),
      iconFile.buffer
    );

    const iconPath = `/uploads/icons/${iconFilename}`;

    const { downloadUrl } = await uploadReleaseAsset({
      accessToken: developer.github.accessToken,
      repoLink,
      fileBuffer: appFile.buffer,
      fileName: `${Date.now()}-${appFile.originalname}`,
      releaseNotes: description,
    });

    const app = await App.create({
      name,
      description,
      icon: iconPath,
      repoLink,
      fileUrl: downloadUrl,
      fileName: appFile.originalname,
      sizeBytes: appFile.buffer.length,
      developer: developer._id,
    });

    await app.populate("developer");

    res.status(201).json(toAppJSON(app));

  } catch (err) {
    console.log("========== CREATE APP ERROR ==========");
    console.log("Message:", err.message);
    console.log("Status:", err.response?.status);
    console.log("URL:", err.config?.url);
    console.log("Response:", err.response?.data);

    res.status(500).json({
      message: err.message,
    });
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
 * published it can delete it. This only removes our DB record and the
 * locally-hosted icon; the actual release/asset stays on GitHub since
 * that's the developer's own repo, not something we manage.
 */
async function deleteApp(req, res) {
  const app = await App.findById(req.params.id);
  if (!app) return res.status(404).json({ message: "App not found" });

  if (app.developer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: "You can only delete your own apps" });
  }

  // Best-effort cleanup of the locally-stored icon file — an upload
  // failure here shouldn't block the actual delete.
  if (app.icon) {
    const iconPath = path.join(UPLOADS_ROOT, app.icon.replace(/^\/uploads\//, ""));
    fs.unlink(iconPath, () => {});
  }

  await App.findByIdAndDelete(req.params.id);
  res.json({ message: "App deleted", id: req.params.id });
}

module.exports = { createApp, listApps, myApps, getApp, downloadApp, deleteApp };
