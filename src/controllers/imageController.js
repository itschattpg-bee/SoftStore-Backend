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

// --- in-memory cache -------------------------------------------------
// Why this exists: GitHub's release-asset CDN throttles a source that
// re-requests the same asset repeatedly in a short window (confirmed by
// testing — hitting the same handful of URLs over and over, even one at
// a time with no concurrency, starts returning 503s). Without caching,
// this proxy re-fetched every icon/screenshot from GitHub on *every*
// page view from *every* user — the same small set of URLs, constantly.
// Caching means each asset is fetched from GitHub once and then served
// from memory until it expires.
const CACHE_MAX_BYTES = 150 * 1024 * 1024; // ~150MB — safe headroom on a 512MB instance
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // matches the Cache-Control header sent to clients

const cache = new Map(); // url -> { buffer, contentType, size, expiresAt }
let cacheBytes = 0;

function cacheGet(url) {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(url);
    cacheBytes -= entry.size;
    return null;
  }
  cache.delete(url); // re-insert so Map iteration order stays LRU
  cache.set(url, entry);
  return entry;
}

function cacheSet(url, buffer, contentType) {
  const size = buffer.length;
  if (size > CACHE_MAX_BYTES) return; // bigger than the whole cache — not worth caching
  while (cacheBytes + size > CACHE_MAX_BYTES && cache.size > 0) {
    const oldestKey = cache.keys().next().value; // Map preserves insertion order
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    cacheBytes -= oldest.size;
  }
  cache.set(url, { buffer, contentType, size, expiresAt: Date.now() + CACHE_TTL_MS });
  cacheBytes += size;
}
// -----------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GitHub's release CDN is inherently a bit flaky under repeated load —
// retry a couple of times on the errors we actually saw (socket hang up
// / ECONNRESET / 503) before giving up.
async function fetchWithRetry(url, attempt = 1) {
  try {
    return await axios.get(url, {
      responseType: "arraybuffer",
      maxRedirects: 5,
      timeout: 10000,
      headers: { "User-Agent": "SoftStore-Backend" },
      validateStatus: (status) => status < 400,
    });
  } catch (err) {
    const transient =
      err.message === "socket hang up" ||
      err.code === "ECONNRESET" ||
      err.response?.status === 503;
    if (transient && attempt < 3) {
      await sleep(300 * attempt);
      return fetchWithRetry(url, attempt + 1);
    }
    throw err;
  }
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

  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "public, max-age=86400");

  const cached = cacheGet(url);
  if (cached) {
    res.set("Content-Type", cached.contentType);
    res.set("Content-Length", cached.size);
    return res.send(cached.buffer);
  }

  try {
    const upstream = await fetchWithRetry(url);
    const buffer = Buffer.from(upstream.data);
    const contentType = upstream.headers["content-type"] || "application/octet-stream";

    cacheSet(url, buffer, contentType);

    res.set("Content-Type", contentType);
    res.set("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error("proxyImage error:", url, err.message);
    res.status(502).json({ message: "Failed to fetch the image" });
  }
}

module.exports = { proxyImage };
