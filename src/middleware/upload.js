const multer = require("multer");
const path = require("path");
const fs = require("fs");

const UPLOADS_ROOT = path.join(__dirname, "..", "..", "uploads");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeImageStorage(subfolder) {
  const dest = path.join(UPLOADS_ROOT, subfolder);
  ensureDir(dest);

  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      cb(null, unique);
    },
  });
}

const imageFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) return cb(null, true);
  cb(new Error("Only image files are allowed"));
};

// Profile photos, saved to disk and served from /uploads/photos/<file>
const uploadPhoto = multer({
  storage: makeImageStorage("photos"),
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// App icons, saved to disk and served from /uploads/icons/<file>
const uploadIcon = multer({
  storage: makeImageStorage("icons"),
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// App creation needs two files at once — an icon image and the APK/ZIP —
// which multer can only do from a single storage engine, so both come in
// as in-memory buffers here. The controller writes the icon buffer to
// /uploads/icons itself and forwards the appFile buffer straight to
// GitHub, so the (potentially huge) binary is never kept on our disk.
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
  limits: { fileSize: 500 * 1024 * 1024 }, // 300 MB
}).fields([
  { name: "icon", maxCount: 1 },
  { name: "appFile", maxCount: 1 },
]);

module.exports = { uploadPhoto, uploadIcon, uploadAppAssets, UPLOADS_ROOT };
