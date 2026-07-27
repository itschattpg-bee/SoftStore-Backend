const mongoose = require("mongoose");
const { CATEGORIES } = require("../constants/categories");

const appSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    // One of the fixed CATEGORIES — powers the home screen's horizontal
    // category scroll and the upload form's category dropdown.
    category: {
      type: String,
      required: true,
      enum: CATEGORIES,
    },
    // "public" apps show up in everyone's home feed; "private" apps only
    // ever show up in their own developer's "Your Apps" screen.
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },
    // Path (served from /uploads/icons/...) to the app icon.
    icon: {
      type: String,
      required: true,
    },
    // Play-Store-style screenshots the developer uploaded, shown on the
    // download screen above "About the developer". Same storage story as
    // the icon — each one is a GitHub release asset URL.
    screenshots: {
      type: [String],
      default: [],
    },
    // The GitHub repo the developer gave us, e.g. https://github.com/owner/repo
    repoLink: {
      type: String,
      required: true,
    },
    // Direct, publicly downloadable URL for the actual APK/ZIP.
    // This points at the file GitHub is hosting (raw.githubusercontent.com
    // or a release asset), since we never store the binary ourselves.
    fileUrl: {
      type: String,
      required: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
    },
    downloads: {
      type: Number,
      default: 0,
    },
    developer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

appSchema.index({ name: "text", description: "text" });

module.exports = mongoose.model("App", appSchema);
