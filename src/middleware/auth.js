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

/**
 * Like requireAuth, but never rejects the request — if there's no
 * token, or it's invalid/expired, req.user is just left undefined and
 * the route handler decides what to do. Used for routes like "get a
 * single app" that are public for everyone but need to know who's
 * asking in order to allow the owner to view their own private app.
 */
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) return next();

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub).select("+github.accessToken");
    if (user) req.user = user;
  } catch {
    // Invalid/expired token on an optional route — just proceed logged-out.
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
