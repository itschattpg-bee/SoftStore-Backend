const axios = require("axios");
const https = require("https");
const http = require("http");

// Hosts permitted to be proxied. Includes GitHub and common CDN targets for release assets.
const ALLOWED_HOSTS = [
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "avatars.githubusercontent.com",
  "api.github.com",
  "release-assets.githubusercontent.com",
  "s3.amazonaws.com",
];

function isAllowedHost(hostname) {
  const lowerHost = hostname.toLowerCase();
  return (
    ALLOWED_HOSTS.some(
      (host) => lowerHost === host || lowerHost.endsWith(`.${host}`)
    ) ||
    lowerHost.includes("githubusercontent.com") ||
    lowerHost.includes("github.com")
  );
}

// In-memory image cache (max 150 items, 24-hour TTL)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ITEMS = 150;
const imageCache = new Map(); // url -> { buffer, contentType, contentLength, etag, expiresAt }

// Map to track in-flight fetch requests for deduplication
const pendingRequests = new Map(); // url -> Promise<{ buffer, contentType, contentLength, etag }>

// Infer Content-Type if GitHub returns application/octet-stream or generic binary
function getContentTypeFromUrl(urlStr, headerType) {
  if (
    headerType &&
    headerType !== "application/octet-stream" &&
    headerType !== "binary/octet-stream"
  ) {
    return headerType;
  }
  const cleanUrl = urlStr.split("?")[0].toLowerCase();
  if (cleanUrl.endsWith(".png")) return "image/png";
  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "image/jpeg";
  if (cleanUrl.endsWith(".webp")) return "image/webp";
  if (cleanUrl.endsWith(".gif")) return "image/gif";
  if (cleanUrl.endsWith(".svg")) return "image/svg+xml";
  if (cleanUrl.endsWith(".ico")) return "image/x-icon";
  return headerType || "image/png";
}

// HTTP/HTTPS Agents with keepAlive disabled to avoid socket hang up on reused TLS sockets
const httpsAgent = new https.Agent({ keepAlive: false, timeout: 15000 });
const httpAgent = new http.Agent({ keepAlive: false, timeout: 15000 });

async function fetchUpstreamImageWithRetry(targetUrl, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(targetUrl, {
        responseType: "arraybuffer",
        maxRedirects: 5,
        timeout: 15000,
        httpsAgent,
        httpAgent,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "close",
        },
        validateStatus: (status) => status < 400,
      });

      const buffer = Buffer.from(response.data);
      const rawContentType = response.headers["content-type"];
      const contentType = getContentTypeFromUrl(targetUrl, rawContentType);
      const etag =
        response.headers["etag"] ||
        `"${buffer.length}-${Buffer.from(targetUrl).toString("base64").slice(-12)}"`;

      return {
        buffer,
        contentType,
        contentLength: buffer.length,
        etag,
      };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[proxyImage] Attempt ${attempt}/${maxRetries} failed for ${targetUrl}: ${err.message}`
      );
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, attempt * 200));
      }
    }
  }
  throw lastErr;
}

/**
 * GET /api/images/proxy?url=<encoded GitHub asset URL>
 *
 * Server-side image proxy with in-memory caching, request coalescing,
 * and retry handling to serve GitHub release assets reliably to Flutter Web
 * without CORS or socket hang up issues.
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
    return res
      .status(400)
      .json({ message: "That host isn't allowed to be proxied" });
  }

  // 1. Check In-Memory Cache
  const cached = imageCache.get(url);
  if (cached && Date.now() < cached.expiresAt) {
    if (req.headers["if-none-match"] === cached.etag) {
      return res.status(304).end();
    }
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=86400, immutable");
    res.set("Content-Type", cached.contentType);
    res.set("Content-Length", cached.contentLength);
    res.set("ETag", cached.etag);
    return res.status(200).send(cached.buffer);
  }

  // 2. Request Coalescing (Deduplication for simultaneous requests)
  let fetchPromise = pendingRequests.get(url);
  if (!fetchPromise) {
    fetchPromise = (async () => {
      try {
        const item = await fetchUpstreamImageWithRetry(url);
        if (imageCache.size >= MAX_CACHE_ITEMS) {
          const oldestKey = imageCache.keys().next().value;
          imageCache.delete(oldestKey);
        }
        imageCache.set(url, {
          ...item,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        return item;
      } finally {
        pendingRequests.delete(url);
      }
    })();
    pendingRequests.set(url, fetchPromise);
  }

  // 3. Serve result
  try {
    const item = await fetchPromise;
    if (req.headers["if-none-match"] === item.etag) {
      return res.status(304).end();
    }
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=86400, immutable");
    res.set("Content-Type", item.contentType);
    res.set("Content-Length", item.contentLength);
    res.set("ETag", item.etag);
    return res.status(200).send(item.buffer);
  } catch (err) {
    console.error("proxyImage error:", err.message);
    return res.status(502).json({ message: "Failed to fetch the image" });
  }
}

module.exports = { proxyImage };


