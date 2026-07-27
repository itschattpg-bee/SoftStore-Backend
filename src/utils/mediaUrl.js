/**
 * Why this exists:
 *
 * App icons and screenshots live on GitHub (release assets), and we hand
 * their raw https://github.com/... / https://objects.githubusercontent.com/...
 * URLs straight to the client. That's fine on Android/iOS, but on
 * Flutter Web the CanvasKit renderer decodes network images by fetching
 * the bytes itself (XHR/fetch) instead of just dropping an <img> tag on
 * the page — and GitHub's asset hosts don't send back
 * `Access-Control-Allow-Origin`, so the browser blocks the response and
 * the image never loads. That's the "web version can't access images"
 * bug.
 *
 * The fix: never hand the client a raw GitHub URL. Instead, rewrite it
 * to a relative path on our own API (`/api/images/proxy?url=...`). The
 * Flutter app already prefixes any relative path it gets back with its
 * API base URL (see ApiService.mediaUrl), so no client changes are
 * needed. Our server fetches the real bytes itself (server-to-server,
 * no CORS involved) and re-serves them with a permissive
 * Access-Control-Allow-Origin header — see controllers/imageController.js.
 */
function toProxiedUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  // Data URIs (profile photos) are already self-contained — no network
  // fetch needed, so no CORS problem, so no proxying needed.
  if (rawUrl.startsWith("data:")) return rawUrl;
  // Legacy local paths like "/uploads/icons/xyz.jpg" are already served
  // by this same origin — no CORS problem there either.
  if (!/^https?:\/\//i.test(rawUrl)) return rawUrl;

  return `/api/images/proxy?url=${encodeURIComponent(rawUrl)}`;
}

/** Applies toProxiedUrl across an array (e.g. an app's screenshots). */
function toProxiedUrls(rawUrls) {
  if (!Array.isArray(rawUrls)) return [];
  return rawUrls.map(toProxiedUrl);
}

module.exports = { toProxiedUrl, toProxiedUrls };
