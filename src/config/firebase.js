const admin = require("firebase-admin");

// Push notifications are entirely optional — if no service account is
// configured, initFirebase() just returns null and notificationService
// silently no-ops, so the rest of the API keeps working fine without it.
//
// To enable push notifications:
//   1. Firebase Console -> Project settings -> Service accounts ->
//      "Generate new private key" (downloads a JSON file).
//   2. Take the ENTIRE contents of that JSON file, minify it to one
//      line, and set it as the FIREBASE_SERVICE_ACCOUNT_JSON env var
//      (in your .env locally, or in Render's Environment tab).
let initialized = false;

function initFirebase() {
  if (initialized) return admin.apps.length ? admin : null;
  initialized = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not set — push notifications are disabled " +
        "(everything else still works). See src/config/firebase.js for setup steps."
    );
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin initialized — push notifications enabled.");
    return admin;
  } catch (err) {
    console.error("Failed to initialize Firebase Admin:", err.message);
    return null;
  }
}

module.exports = { initFirebase };
