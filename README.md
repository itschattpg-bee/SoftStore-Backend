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
- `category` — one of the fixed list in `src/constants/categories.js`
  (`E-Commerce`, `Social & Communication`, `FinTech`, `EdTech`,
  `Healthcare`, `Business & Productivity`). Required on upload; powers
  both the home screen's category scroll and the upload form's dropdown.
- `visibility` — `"public"` (default, shows in everyone's home feed) or
  `"private"` (only ever shows up in its developer's own "Your Apps"
  screen and download screen — a 404 for everyone else).
- `screenshots` — array of GitHub release-asset URLs, uploaded the same
  way as the icon. Shown on the download screen, Play-Store style.

**Review** (new)
- `app` (ref → App), `user` (ref → User), `rating` (1–5), `comment`
- One review per user per app — leaving a review again just edits your
  existing one instead of creating a duplicate.

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
| GET | `/api/apps?search=term&category=term` | – | home feed, **public apps only**, newest first, optional name search + exact category filter |
| GET | `/api/apps/categories` | – | the fixed list of category strings, for the dropdown/scroll |
| GET | `/api/apps/mine` | ✅ | every app you've published, public **and** private |
| POST | `/api/apps` | ✅ | multipart: `name, description, category, visibility? ("public"|"private", default public), repoLink, icon (file), appFile (file), screenshots (files, up to 6, optional)` — requires GitHub connected first |
| GET | `/api/apps/:id` | optional | single app, for the download screen. If the app is private, only its developer (when logged in) gets it — everyone else gets a 404 |
| GET | `/api/apps/:id/download` | – | increments the counter, 302-redirects to the GitHub file |
| DELETE | `/api/apps/:id` | ✅ | developer-only |

Every app response includes a populated `developer` object
(`name, username, photo, verified`), a human-readable `size` string
alongside the raw `sizeBytes`, and `avgRating` / `reviewsCount` rolled up
from that app's reviews.

### Reviews
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/apps/:id/reviews` | – | every review for the app, newest first |
| POST | `/api/apps/:id/reviews` | ✅ | json/form: `{ rating: 1-5, comment }` — leaves your review, or edits it if you already left one |
| DELETE | `/api/apps/:id/reviews` | ✅ | removes your own review |

### Images
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/images/proxy?url=<encoded GitHub asset URL>` | – | streams the image back with an open CORS header — see "Why the image proxy exists" below |

## 7. Why the image proxy exists (the web image bug)

Icons and screenshots are stored as GitHub release assets, and the app
just used their raw `github.com` / `objects.githubusercontent.com` URLs
directly. That's fine on Android/iOS, but **Flutter Web's CanvasKit
renderer fetches network images itself (via `fetch`/XHR) instead of
dropping a plain `<img>` tag on the page**, and GitHub's asset hosts
don't send back an `Access-Control-Allow-Origin` header — so the browser
silently blocks the response and the image never renders. That was the
"web version can't load images" bug.

The fix: the server never hands the client a raw GitHub URL anymore.
`toAppJSON` rewrites `icon` and every entry in `screenshots` through
`utils/mediaUrl.js`, which turns them into a relative path like
`/api/images/proxy?url=<encoded original>`. The Flutter app already
prefixes any relative path with its API base URL (see
`ApiService.mediaUrl`), so **no client changes were needed for this
fix** — it "just works" once the backend is updated. `imageController.js`
fetches the real image server-side (plain server-to-server HTTP, no
CORS involved) and re-serves it with `Access-Control-Allow-Origin: *`.
Only GitHub's own hosts are allowed through the proxy (see
`ALLOWED_HOSTS`), so it can't be used as an open relay.

Profile photos are unaffected — those are stored as base64 `data:` URIs
directly on the User document, which never touch the network in the
first place and so were never subject to this bug.

## 8. Typical upload flow (client-side)

1. User registers/logs in → gets a JWT.
2. User taps "Connect GitHub" on their profile → `GET /api/users/me/github/connect`
   → open the returned URL → user authorizes → GitHub hits our callback →
   `github.connected` becomes `true`.
3. User fills out the upload form (icon, name, description, category,
   public/private, repo link, `.apk`/`.zip`, optional screenshots) →
   `POST /api/apps` → we push every file into their repo (as assets on
   one release) and save the listing.
4. Home screen calls `GET /api/apps` and shows every **public** app from
   everyone, filtered live as they type in the search box and/or tap a
   category chip.
5. Tapping an app calls `GET /api/apps/:id` to render the download
   screen (screenshots gallery, about, about the developer, reviews),
   and the Download button hits `GET /api/apps/:id/download`, which
   redirects straight to the file on GitHub.
6. On that same screen, anyone logged in can call
   `POST /api/apps/:id/reviews` to leave a star rating + comment, and
   `GET /api/apps/:id/reviews` powers the list shown under the
   screenshots/about-the-developer section.
