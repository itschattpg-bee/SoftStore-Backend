function getBaseUrl() {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, "");
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  }
  return "https://softstore-backend.onrender.com";
}

/**
 * Converts external media URLs (e.g. GitHub release assets) into absolute
 * proxied URLs targeting our backend API (`https://softstore-backend.onrender.com/api/images/proxy?url=...`).
 *
 * Using absolute URLs ensures that web apps deployed on external origins
 * (e.g. Netlify) route image requests directly to this backend instead of
 * attempting to resolve relative paths against the frontend host.
 */
function toProxiedUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  // Data URIs (profile photos) are self-contained
  if (rawUrl.startsWith("data:")) return rawUrl;
  // Prevent double-proxying
  if (rawUrl.includes("/api/images/proxy")) return rawUrl;
  // Local paths or non-HTTP URIs stay as-is
  if (!/^https?:\/\//i.test(rawUrl)) return rawUrl;

  const baseUrl = getBaseUrl();
  return `${baseUrl}/api/images/proxy?url=${encodeURIComponent(rawUrl)}`;
}

/** Applies toProxiedUrl across an array (e.g. an app's screenshots). */
function toProxiedUrls(rawUrls) {
  if (!Array.isArray(rawUrls)) return [];
  return rawUrls.map(toProxiedUrl);
}

module.exports = { toProxiedUrl, toProxiedUrls };

