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

## 5. Push notifications (Firebase Cloud Messaging) — step by step

Push notifications need a free Firebase project. This is a one-time setup.
Nothing else in the app breaks if you skip this — the server just logs a
warning and every push send silently no-ops.

### 5.1 Create the Firebase project

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"** (or **"Create a project"**)
3. Give it a name, e.g. `softstore` → click **Continue**
4. Google Analytics toggle: you can turn this **off**, it's not needed →
   click **Create project** → wait for it → **Continue**

### 5.2 Add your apps to the project (so devices can receive pushes)

You need to register each platform you'll actually ship on. In the
Firebase console, on your new project's **Project Overview** page:

1. Click the **Android icon** (if you build for Android):
   - **Android package name**: must exactly match `applicationId` in
     `android/app/build.gradle` (e.g. `com.yourcompany.softstore`)
   - Click **Register app**
   - **Download `google-services.json`** → put it at
     `frontend/android/app/google-services.json` in the Flutter project
   - You can click through/skip the SDK setup steps shown — the Flutter
     `firebase_core`/`firebase_messaging` packages handle that part
2. Click the **iOS icon** (if you build for iOS), same idea:
   - **Apple bundle ID**: must match the one in Xcode
   - **Download `GoogleService-Info.plist`** → put it at
     `frontend/ios/Runner/GoogleService-Info.plist`
   - iOS pushes additionally need an **APNs key**: Apple Developer
     account → **Certificates, Identifiers & Profiles** → **Keys** → **+**
     → check **Apple Push Notifications service (APNs)** → download the
     `.p8` key → back in Firebase, **Project settings** (gear icon, top
     left) → **Cloud Messaging** tab → **Apple app configuration** →
     **Upload** the `.p8` key with its Key ID and your Team ID
3. Click the **Web icon** `</>` too if you'll ever run this as Flutter Web

### 5.3 Get the backend its service account key (this is what THIS server needs)

1. In the Firebase console, click the **gear icon** (top left, next to
   "Project Overview") → **Project settings**
2. Go to the **Service accounts** tab
3. Click **"Generate new private key"** → confirm → it downloads a
   `.json` file (keep this secret — it's a full admin credential)
4. Open that file, copy its entire contents, and minify it to a single
   line (no real line breaks). Set it as an environment variable:
   - **Locally**: add to your `.env`:
     `FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...", ...}`
   - **On Render** (or wherever you deploy): dashboard → your service →
     **Environment** tab → **Add Environment Variable** → key
     `FIREBASE_SERVICE_ACCOUNT_JSON`, value = the same minified JSON
5. Restart the server. You should see:
   ```
   Firebase Admin initialized — push notifications enabled.
   ```
   in the logs instead of the "disabled" warning.

### 5.4 Set up the Flutter side

See the frontend project's own README/comments in `lib/services/push_service.dart`
for what's needed there (`flutterfire configure`, requesting permission,
etc.) — that part happens once you've done 5.1–5.2 above, since it needs
the config files you just downloaded.

## 6. Data model

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

## 7. API reference

All authenticated routes need `Authorization: Bearer <token>` from
register/login.

### Health
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok, status, db, uptimeSeconds, timestamp }` — `ok`/status 200 only when Mongo is actually connected, otherwise 503 |

### Auth
| Method | Route | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | multipart: `name, username, email, password, photo?` | returns `{ token, user }` |
| POST | `/api/auth/login` | json: `{ identifier, password }` | `identifier` = email or username |

### Users
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/users/me` | ✅ | your profile + live `appsCount`, `totalDownloads`, `avgRating`, `ratedAppsCount` |
| PUT | `/api/users/me` | ✅ | multipart: `name?, username?, about?, photo?` |
| GET | `/api/users/:username` | – | public profile, for "about the developer" — same stats fields as above |
| GET | `/api/users/me/github/connect` | ✅ | returns `{ url }` — open it in a browser/webview |
| GET | `/api/users/github/callback` | – | GitHub redirects here itself, don't call directly |
| POST | `/api/users/me/fcm-token` | ✅ | json: `{ token }` — registers a device for push notifications |
| DELETE | `/api/users/me/fcm-token` | ✅ | json: `{ token }` — call on logout so that device stops getting pushes for this account |

`totalDownloads` is the sum of every app you've published; `avgRating` is
the mean of each of your *rated* apps' own average rating (apps with no
reviews yet don't count toward it).

### Apps
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/apps?search=term&category=term` | – | home feed, **public apps only**, newest first, optional name search + exact category filter |
| GET | `/api/apps/categories` | – | the fixed list of category strings, for the dropdown/scroll |
| GET | `/api/apps/mine` | ✅ | every app you've published, public **and** private |
| POST | `/api/apps` | ✅ | multipart: `name, description, category, visibility? ("public"|"private", default public), repoLink, icon (file), appFile (file), screenshots (files, up to 6, optional), notifyAllUsers? ("true"/"false", default false)` — requires GitHub connected first. If `notifyAllUsers` is true, every other user with a registered device gets a push notification about the new app |
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
| POST | `/api/apps/:id/reviews` | ✅ | json/form: `{ rating: 1-5, comment }` — leaves your review, or edits it if you already left one. On a brand-new review (not an edit), the app's developer gets a push notification |
| DELETE | `/api/apps/:id/reviews` | ✅ | removes your own review |

### Images
| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/api/images/proxy?url=<encoded GitHub asset URL>` | – | streams the image back with an open CORS header — see "Why the image proxy exists" below |

## 8. Why the image proxy exists (the web image bug)

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

## 9. Typical upload flow (client-side)

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
