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
 * Uploads the app binary as a GitHub **Release asset** instead of a
 * regular committed file. The Contents API used above caps out at 100MB
 * and can't be raised — Releases support assets up to 2GB, which is what
 * lets us support APK/ZIPs up to 300MB.
 *
 * Each upload creates its own release (unique tag per upload), then
 * attaches the binary to it. Returns the asset's public download URL,
 * same shape as uploadFileToRepo so callers don't need to change.
 */
async function uploadReleaseAsset({
  accessToken,
  repoLink,
  fileBuffer,
  fileName,
  releaseNotes,
}) {
  const { owner, repo } = parseRepoLink(repoLink);

  console.log("========== GITHUB UPLOAD ==========");
  console.log("Owner:", owner);
  console.log("Repo:", repo);
  console.log("Repo Link:", repoLink);

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
  };

  const tagName = `softstore-${Date.now()}`;

  try {
    console.log("Creating GitHub release...");

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

    console.log("Release created:", release.data.id);

    const uploadUrl =
      release.data.upload_url.split("{")[0] +
      `?name=${encodeURIComponent(fileName)}`;

    console.log("Upload URL:", uploadUrl);

    const asset = await axios.post(uploadUrl, fileBuffer, {
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Content-Length": fileBuffer.length,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    console.log("Asset uploaded successfully");

    return {
      downloadUrl: asset.data.browser_download_url,
      htmlUrl: release.data.html_url,
    };
  } catch (err) {
    console.log("========== GITHUB ERROR ==========");
    console.log("Status:", err.response?.status);
    console.log("URL:", err.config?.url);
    console.log("Response:", err.response?.data);
    throw err;
  }
}

module.exports = {
  getAuthorizeUrl,
  exchangeCodeForToken,
  getGithubUser,
  parseRepoLink,
  uploadFileToRepo,
  uploadReleaseAsset,
};
