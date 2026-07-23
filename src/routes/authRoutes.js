const express = require("express");
const { register, login } = require("../controllers/authController");
const { uploadPhoto } = require("../middleware/upload");

const router = express.Router();

// multipart/form-data: name, username, email, password, photo (optional file)
router.post("/register", uploadPhoto.single("photo"), register);

// JSON: { identifier, password } — identifier can be email or username
router.post("/login", login);

module.exports = router;
