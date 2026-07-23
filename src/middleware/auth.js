const { verifyToken } = require("../utils/jwt");
const User = require("../models/User");

/**
 * Requires a valid `Authorization: Bearer <token>` header.
 * Attaches the authenticated user document to req.user.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ message: "Missing or invalid Authorization header" });
    }

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub).select("+github.accessToken");

    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };
