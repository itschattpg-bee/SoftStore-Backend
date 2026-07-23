const express = require("express");
const {
  createApp,
  listApps,
  myApps,
  getApp,
  downloadApp,
  deleteApp,
} = require("../controllers/appController");
const { requireAuth } = require("../middleware/auth");
const { uploadAppAssets } = require("../middleware/upload");

const router = express.Router();

// Keep /mine above /:id so "mine" isn't parsed as an app id.
router.get("/mine", requireAuth, myApps);

router.get("/", listApps); // ?search=term for the home screen's search box
router.post("/", requireAuth, uploadAppAssets, createApp);
router.get("/:id", getApp);
router.get("/:id/download", downloadApp);
router.delete("/:id", requireAuth, deleteApp);

module.exports = router;
