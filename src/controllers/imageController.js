const axios = require("axios");

// Only ever proxy through to hosts we actually put images on — this is a
// simple allowlist so the proxy can't be abused as an open SSRF relay to
// fetch arbitrary URLs.
const ALLOWED_HOSTS = [
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "avatars.githubusercontent.com",
  "api.github.com",
];

function isAllowedHost(hostname) {
  return ALLOWED_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  );
}

/**
 * GET /api/images/proxy?url=<encoded GitHub asset URL>
 *
 * Fetches the image server-side and streams it straight back with an
 * open CORS header, so Flutter Web (which fetches image bytes itself
 * rather than using a plain <img> tag) can actually load it — GitHub's
 * asset hosts don't send Access-Control-Allow-Origin themselves. See
 * utils/mediaUrl.js for the full explanation.
 */
async function proxyImage(req, res) {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ message: "url query param is required" });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ message: "Invalid url" });
  }

  if (!isAllowedHost(parsed.hostname)) {
    return res.status(400).json({ message: "That host isn't allowed to be proxied" });
  }

  try {
    const upstream = await axios.get(url, {
      responseType: "stream",
      maxRedirects: 5,
      headers: { "User-Agent": "SoftStore-Backend" },
      validateStatus: (status) => status < 400,
    });

    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=86400");
    if (upstream.headers["content-type"]) {
      res.set("Content-Type", upstream.headers["content-type"]);
    }
    if (upstream.headers["content-length"]) {
      res.set("Content-Length", upstream.headers["content-length"]);
    }

    upstream.data.pipe(res);
  } catch (err) {
    console.error("proxyImage error:", err.message);
    res.status(502).json({ message: "Failed to fetch the image" });
  }
}

module.exports = { proxyImage };
