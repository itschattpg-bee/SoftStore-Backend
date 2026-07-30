const mongoose = require("mongoose");

const DEFAULT_ABOUT =
  "Flutter developer passionate about building beautiful mobile applications with Flutter.";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // The "@handle" shown across the app. Stored lowercase, unique.
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9_.]{3,20}$/, "Username can only contain letters, numbers, dots and underscores"],
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    // Path (served from /uploads/photos/...) to the profile photo.
    photo: {
      type: String,
      default: null,
    },
    about: {
      type: String,
      default: DEFAULT_ABOUT,
    },
    // Hardcoded for now, per product requirements — every account is
    // shown as verified and with the same skill set until that becomes
    // a real feature.
    skills: {
      type: [String],
      default: ["Flutter", "Dart"],
    },
    verified: {
      type: Boolean,
      default: true,
    },
    github: {
      connected: { type: Boolean, default: false },
      username: { type: String, default: null },
      // Access token for the GitHub OAuth App. Kept server-side only,
      // never sent to the client (see toPublicJSON below).
      accessToken: { type: String, default: null, select: false },
    },
    // FCM registration tokens for every device this user is logged in
    // on (one per device/install). Used to push notifications for new
    // app uploads and new comments. Never sent to the client.
    fcmTokens: {
      type: [String],
      default: [],
      select: false,
    },
  },
  { timestamps: true }
);

// Shape returned to clients — never leak passwordHash or the GitHub token.
userSchema.methods.toPublicJSON = function () {
  return {
    id: this._id,
    name: this.name,
    username: this.username,
    email: this.email,
    photo: this.photo,
    about: this.about,
    skills: this.skills,
    verified: this.verified,
    github: {
      connected: this.github?.connected || false,
      username: this.github?.username || null,
    },
    createdAt: this.createdAt,
  };
};

userSchema.statics.DEFAULT_ABOUT = DEFAULT_ABOUT;

module.exports = mongoose.model("User", userSchema);
