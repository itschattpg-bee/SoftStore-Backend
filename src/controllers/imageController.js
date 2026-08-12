const axios = require("axios");
const https = require("https");

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

// Reuse connections instead of opening a fresh TLS handshake for every
// single proxied image — GitHub resets a burst of brand-new sockets
// arriving at once (that's the "socket hang up" errors in the logs).
const githubAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });

// Cap how many proxy fetches to GitHub run at the same time. A screen
// with 6 screenshots + an icon fires 7 requests at once — queue them so
// only a few are ever in flight together instead of all 7 hitting
// GitHub in the same instant.
const MAX_CONCURRENT = 3;
let active = 0;
const queue = [];

function runNext() {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  active++;
  const { task, resolve, reject } = queue.shift();
  task()
    .then(resolve, reject)
    .finally(() => {
      active--;
      runNext();
    });
}

function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    runNext();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "socket hang up" / ECONNRESET here are transient — GitHub reset the
// connection, not a real failure — so a quick retry usually succeeds
// (this matches the logs: screenshot-0 succeeded right after -1 to -5
// all failed).
async function fetchWithRetry(url, attempt = 1) {
  try {
    return await axios.get(url, {
      responseType: "stream",
      maxRedirects: 5,
      timeout: 10000,
      httpsAgent: githubAgent,
      headers: { "User-Agent": "SoftStore-Backend" },
      validateStatus: (status) => status < 400,
    });
  } catch (err) {
    const transient = err.message === "socket hang up" || err.code === "ECONNRESET";
    if (transient && attempt < 3) {
      await sleep(250 * attempt);
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

  try {
    const upstream = await schedule(() => fetchWithRetry(url));

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
    console.error("proxyImage error:", url, err.message);
    res.status(502).json({ message: "Failed to fetch the image" });
  }
}

module.exports = { proxyImage };
