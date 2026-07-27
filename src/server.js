require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const appRoutes = require("./routes/appRoutes");
const imageRoutes = require("./routes/imageRoutes");

const app = express();

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Legacy-only: older records created before photos/icons moved to
// MongoDB (base64) and GitHub releases may still reference a local
// /uploads/... path. Harmless to keep — just 404s if the file isn't
// there, which it usually won't be on hosts with an ephemeral disk
// (like Render) after a restart.
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/apps", appRoutes);
app.use("/api/images", imageRoutes);

// Multer / general error handler — so bad uploads return clean JSON
// instead of an HTML stack trace.
app.use((err, req, res, next) => {
  if (err) {
    console.error(err);
    return res.status(400).json({ message: err.message || "Something went wrong" });
  }
  next();
});

app.use((req, res) => res.status(404).json({ message: "Not found" }));

const PORT = process.env.PORT || 4000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`SoftStore API listening on http://localhost:${PORT}`);
  });
});
