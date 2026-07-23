# SoftStore backend

Local Node.js + Express + MongoDB backend for the SoftStore Flutter app.

How app files actually get stored: SoftStore never stores your `.apk`/`.zip`
itself. When you upload an app, the server pushes that file straight into
**your own GitHub repo** (the one whose link you provide) using a GitHub
OAuth token tied to your account, and stores the GitHub download URL. Icons
and profile photos, on the other hand, are small enough to just live on
this server under `/uploads`.

## 1. Prerequisites

- Node.js 18+
- A local MongoDB server running (e.g. `mongod` on the default port), so
  MongoDB Compass can connect to `mongodb://127.0.0.1:27017`
- A GitHub OAuth App (free, takes 2 minutes) — see step 3

## 2. Install & configure

```bash
cd server
npm install
cp .env.example .env
```

Open `.env` and fill in:
- `JWT_SECRET` — any random string
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — from step 3
- `MONGO_URI` — only change this if your local MongoDB isn't on the default
  host/port

## 3. Create a GitHub OAuth App

This is what lets a user "connect GitHub" so we can push their APK/ZIP into
their repo on their behalf.

1. Go to https://github.com/settings/developers → **New OAuth App**
2. **Homepage URL**: `http://localhost:4000`
3. **Authorization callback URL**: `http://localhost:4000/api/users/github/callback`
4. Save, then copy the **Client ID** and generate a **Client Secret** into
   your `.env`

## 4. Run it

```bash
npm run dev     # nodemon, auto-restarts on changes
# or
npm start
```

You should see:
```
MongoDB connected -> mongodb://127.0.0.1:27017/softstore
SoftStore API listening on http://localhost:4000
```

Open MongoDB Compass and connect to the same URI to browse the `softstore`
database (`users` and `apps` collections) as data comes in.

If you're testing from a physical phone/emulator rather than this same
machine, use your machine's LAN IP instead of `localhost` in the Flutter
app's base URL (and in `GITHUB_CALLBACK_URL` / the GitHub OAuth App
settings, if you want GitHub connect to work from the device too).

## 5. Data model

**User**
- `name`, `username` (the `@handle`), `email`, `photo`
- `about` — starts as the same default text for everyone, editable, and
  reflected everywhere that developer is shown (home feed, download
  screen, etc.) since apps only store a reference to the developer and
  populate the live document on every read
- `skills`, `verified` — hardcoded for now, as requested
- `github: { connected, username, accessToken }` — `accessToken` is never
  sent to the client

**App**
- `name`, `description`, `icon`, `repoLink`, `fileUrl` (GitHub download
  URL), `fileName`, `sizeBytes`, `downloads`, `developer` (ref → User)

## 6. API reference

All authenticated routes need `Authorization: Bearer <token>` from
register/login.

### Auth
| Method | Route | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | multipart: `name, username, email, password, photo?` | returns `{ token, user }` |
| POST | `/api/auth/login` | json: `{ identifier, password }` | `identifier` = email or username |

### Users
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/users/me` | ✅ | your profile + live `appsCount` |
| PUT | `/api/users/me` | ✅ | multipart: `name?, username?, about?, photo?` |
| GET | `/api/users/:username` | – | public profile, for "about the developer" |
| GET | `/api/users/me/github/connect` | ✅ | returns `{ url }` — open it in a browser/webview |
| GET | `/api/users/github/callback` | – | GitHub redirects here itself, don't call directly |

### Apps
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/apps?search=term` | – | home feed, newest first, name search |
| GET | `/api/apps/mine` | ✅ | apps you've published |
| POST | `/api/apps` | ✅ | multipart: `name, description, repoLink, icon (file), appFile (file)` — requires GitHub connected first |
| GET | `/api/apps/:id` | – | single app, for the download screen |
| GET | `/api/apps/:id/download` | – | increments the counter, 302-redirects to the GitHub file |

Every app response includes a populated `developer` object
(`name, username, photo, verified`) and a human-readable `size` string
alongside the raw `sizeBytes`.

## 7. Typical upload flow (client-side)

1. User registers/logs in → gets a JWT.
2. User taps "Connect GitHub" on their profile → `GET /api/users/me/github/connect`
   → open the returned URL → user authorizes → GitHub hits our callback →
   `github.connected` becomes `true`.
3. User fills out the upload form (icon, name, description, repo link,
   `.apk`/`.zip`) → `POST /api/apps` → we push the file into their repo and
   save the listing.
4. Home screen calls `GET /api/apps` and shows every app from everyone,
   filtered live as they type in the search box.
5. Tapping an app calls `GET /api/apps/:id` to render the download screen,
   and the Download button hits `GET /api/apps/:id/download`, which
   redirects straight to the file on GitHub.
