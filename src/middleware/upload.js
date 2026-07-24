const multer = require("multer");
const path = require("path");

const imageFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) return cb(null, true);
  cb(new Error("Only image files are allowed"));
};

// Profile photos — kept in memory only. The controller base64-encodes
// the buffer and stores it directly on the User document (Render's disk
// is ephemeral, so nothing meant to persist can live on local disk).
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// App creation needs two files at once — an icon image and the APK/ZIP —
// both come in as in-memory buffers. The controller pushes both into the
// same GitHub release (via the developer's connected OAuth token), so
// neither ever touches our own disk.
const uploadAppAssets = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "icon") {
      if (file.mimetype.startsWith("image/")) return cb(null, true);
      return cb(new Error("icon must be an image file"));
    }
    if (file.fieldname === "appFile") {
      const allowed = [".apk", ".zip"];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowed.includes(ext)) return cb(null, true);
      return cb(new Error("appFile must be a .apk or .zip file"));
    }
    cb(new Error(`Unexpected field: ${file.fieldname}`));
  },
  limits: { fileSize: 300 * 1024 * 1024 }, // 300 MB
}).fields([
  { name: "icon", maxCount: 1 },
  { name: "appFile", maxCount: 1 },
]);

module.exports = { uploadPhoto, uploadAppAssets };
