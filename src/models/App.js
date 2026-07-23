const mongoose = require("mongoose");

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
    // Path (served from /uploads/icons/...) to the app icon.
    icon: {
      type: String,
      required: true,
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
