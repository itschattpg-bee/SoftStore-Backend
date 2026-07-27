const express = require("express");
const {
  createApp,
  listApps,
  listCategories,
  myApps,
  getApp,
  downloadApp,
  deleteApp,
} = require("../controllers/appController");
const {
  listReviews,
  upsertReview,
  deleteReview,
} = require("../controllers/reviewController");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { uploadAppAssets } = require("../middleware/upload");

const router = express.Router();

// Keep these fixed sub-paths above "/:id" so they aren't parsed as an app id.
router.get("/mine", requireAuth, myApps);
router.get("/categories", listCategories);

router.get("/", listApps); // ?search=term&category=term for the home screen
router.post("/", requireAuth, uploadAppAssets, createApp);

// optionalAuth: public apps are visible to anyone, but a private app is
// only visible if the requester is logged in as its developer.
router.get("/:id", optionalAuth, getApp);
router.get("/:id/download", downloadApp);
router.delete("/:id", requireAuth, deleteApp);

// Reviews — every user can read reviews for an app; only a logged-in
// user can leave/edit/delete their own.
router.get("/:id/reviews", listReviews);
router.post("/:id/reviews", requireAuth, upsertReview);
router.delete("/:id/reviews", requireAuth, deleteReview);

module.exports = router;
