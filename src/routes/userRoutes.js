const express = require("express");
const {
  getMe,
  getByUsername,
  updateMe,
  githubConnect,
  githubCallback,
  registerFcmToken,
  unregisterFcmToken,
} = require("../controllers/userController");
const { requireAuth } = require("../middleware/auth");
const { uploadPhoto } = require("../middleware/upload");

const router = express.Router();

// NOTE: GitHub calls this one directly with no Authorization header of
// ours, so it must be public and stay above any auth-protected routes.
router.get("/github/callback", githubCallback);

router.get("/me", requireAuth, getMe);
router.put("/me", requireAuth, uploadPhoto.single("photo"), updateMe);
router.get("/me/github/connect", requireAuth, githubConnect);
router.post("/me/fcm-token", requireAuth, registerFcmToken);
router.delete("/me/fcm-token", requireAuth, unregisterFcmToken);

// Public profile lookup — keep this last so it doesn't swallow /me routes.
router.get("/:username", getByUsername);

module.exports = router;
