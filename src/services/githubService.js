const axios = require("axios");

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL;

/**
 * Builds the URL the client should open in a browser/webview to let the
 * user authorize our GitHub OAuth App. `state` round-trips through GitHub
 * and comes back on the callback — we use it to carry our own user id so
 * we know whose account to attach the resulting token to.
 */
function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    scope: "repo", // needed to read/write files in the user's repos
    state,
    allow_signup: "true",
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/** Exchanges the temporary `code` GitHub gave us for a real access token. */
async function exchangeCodeForToken(code) {
  const response = await axios.post(
    "https://github.com/login/oauth/access_token",
    {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_CALLBACK_URL,
    },
    { headers: { Accept: "application/json" } }
  );

  if (response.data.error) {
    throw new Error(response.data.error_description || response.data.error);
  }

  return response.data.access_token;
}

/** Fetches the GitHub username for the account behind an access token. */
async function getGithubUser(accessToken) {
  const response = await axios.get("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.data; // includes .login (username), .avatar_url, etc.
}

/**
 * Parses a GitHub repo URL like:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   github.com/owner/repo
 * into { owner, repo }.
 */
function parseRepoLink(repoLink) {
  const cleaned = repoLink.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);

  if (!match) {
    throw new Error(
      "repoLink must be a GitHub repo URL, e.g. https://github.com/owner/repo"
    );
  }

  return { owner: match[1], repo: match[2] };
}

/**
 * Uploads (creates or updates) a file in the developer's GitHub repo using
 * the Contents API, and returns the public download URL GitHub gives us
 * back — that URL is what we store as App.fileUrl and hand to downloaders.
 */
async function uploadFileToRepo({ accessToken, repoLink, filePath, fileBuffer, commitMessage }) {
  const { owner, repo } = parseRepoLink(repoLink);
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
  };

  // If a file already exists at this path, GitHub requires its current
  // blob `sha` to overwrite it — check first so re-uploads don't fail.
  let existingSha;
  try {
    const existing = await axios.get(apiUrl, { headers });
    existingSha = existing.data.sha;
  } catch (err) {
    if (err.response?.status !== 404) throw err;
  }

  const response = await axios.put(
    apiUrl,
    {
      message: commitMessage || `Add ${filePath} via SoftStore`,
      content: fileBuffer.toString("base64"),
      ...(existingSha ? { sha: existingSha } : {}),
    },
    { headers }
  );

  return {
    downloadUrl: response.data.content.download_url,
    htmlUrl: response.data.content.html_url,
  };
}

/**
 * Creates one GitHub release and uploads both the app icon and the
 * APK/ZIP to it as separate assets — so the developer's repo ends up
 * with a single release containing everything for that version (matches
 * how the actual Play Store bundles an icon alongside the binary).
 * Returns the public download URL for each.
 */
async function publishAppRelease({
  accessToken,
  repoLink,
  iconBuffer,
  iconFileName,
  appBuffer,
  appFileName,
  releaseNotes,
}) {
  const { owner, repo } = parseRepoLink(repoLink);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
  };

  // Unique tag so repeat uploads never collide with an existing release.
  const tagName = `softstore-${Date.now()}`;

  const release = await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/releases`,
    {
      tag_name: tagName,
      name: appFileName,
      body: releaseNotes || "Published via SoftStore",
      draft: false,
      prerelease: false,
    },
    { headers }
  );

  // upload_url comes back as a URI template, e.g.
  // "https://uploads.github.com/repos/owner/repo/releases/123/assets{?name,label}"
  const uploadUrlBase = release.data.upload_url.split("{")[0];

  async function uploadAsset(buffer, fileName) {
    const uploadUrl = `${uploadUrlBase}?name=${encodeURIComponent(fileName)}`;
    const asset = await axios.post(uploadUrl, buffer, {
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Content-Length": buffer.length,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return asset.data.browser_download_url;
  }

  const iconUrl = await uploadAsset(iconBuffer, iconFileName);
  const fileUrl = await uploadAsset(appBuffer, appFileName);

  return { iconUrl, fileUrl, htmlUrl: release.data.html_url };
}

/**
 * Uploads the app binary as a GitHub **Release asset** instead of a
 * regular committed file. The Contents API used above caps out at 100MB
 * and can't be raised — Releases support assets up to 2GB, which is what
 * lets us support APK/ZIPs up to 300MB.
 *
 * Each upload creates its own release (unique tag per upload), then
 * attaches the binary to it. Returns the asset's public download URL,
 * same shape as uploadFileToRepo so callers don't need to change.
 *
 * Kept for backwards compatibility — createApp now uses
 * publishAppRelease instead, since it needs to upload the icon too.
 */
async function uploadReleaseAsset({ accessToken, repoLink, fileBuffer, fileName, releaseNotes }) {
  const { owner, repo } = parseRepoLink(repoLink);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
  };

  // Unique tag so repeat uploads never collide with an existing release.
  const tagName = `softstore-${Date.now()}`;

  const release = await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/releases`,
    {
      tag_name: tagName,
      name: fileName,
      body: releaseNotes || "Published via SoftStore",
      draft: false,
      prerelease: false,
    },
    { headers }
  );

  // upload_url comes back as a URI template, e.g.
  // "https://uploads.github.com/repos/owner/repo/releases/123/assets{?name,label}"
  const uploadUrl =
    release.data.upload_url.split("{")[0] + `?name=${encodeURIComponent(fileName)}`;

  const asset = await axios.post(uploadUrl, fileBuffer, {
    headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
      "Content-Length": fileBuffer.length,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return {
    downloadUrl: asset.data.browser_download_url,
    htmlUrl: release.data.html_url,
  };
}

module.exports = {
  getAuthorizeUrl,
  exchangeCodeForToken,
  getGithubUser,
  parseRepoLink,
  uploadFileToRepo,
  uploadReleaseAsset,
  publishAppRelease,
};
