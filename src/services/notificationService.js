const User = require("../models/User");
const { initFirebase } = require("../config/firebase");

// FCM's sendEachForMulticast caps out at 500 tokens per call.
const MAX_TOKENS_PER_BATCH = 500;

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/**
 * Sends one push notification to a list of raw FCM device tokens.
 * No-ops quietly if Firebase Admin was never configured (see
 * config/firebase.js), so the rest of the app works fine without push
 * notifications set up. Any tokens FCM reports as dead (uninstalled
 * app, expired token, etc.) get pruned off every user automatically.
 */
async function sendToTokens(tokens, { title, body, data } = {}) {
  const admin = initFirebase();
  const cleanTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!admin || !cleanTokens.length) return;

  // FCM data payloads must be flat string->string maps.
  const stringData = Object.fromEntries(
    Object.entries(data || {}).map(([k, v]) => [k, String(v)])
  );

  const deadTokens = [];

  for (const batch of chunk(cleanTokens, MAX_TOKENS_PER_BATCH)) {
    try {
      const result = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data: stringData,
      });
      result.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error?.code;
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token" ||
            code === "messaging/invalid-argument"
          ) {
            deadTokens.push(batch[i]);
          }
        }
      });
    } catch (err) {
      console.error("notificationService.sendToTokens error:", err.message);
    }
  }

  if (deadTokens.length) {
    await User.updateMany({}, { $pull: { fcmTokens: { $in: deadTokens } } });
  }
}

/** Pushes to every device a single user has registered. */
async function notifyUser(userId, { title, body, data } = {}) {
  if (!userId) return;
  const user = await User.findById(userId).select("+fcmTokens");
  if (!user) return;
  await sendToTokens(user.fcmTokens, { title, body, data });
}

/**
 * Pushes to every device of every user that has at least one
 * registered token, optionally skipping one user (e.g. the developer
 * who just published the app that triggered this).
 */
async function notifyAllUsers({ title, body, data, excludeUserId } = {}) {
  const filter = { fcmTokens: { $exists: true, $ne: [] } };
  if (excludeUserId) filter._id = { $ne: excludeUserId };
  const users = await User.find(filter).select("+fcmTokens");
  const tokens = users.flatMap((u) => u.fcmTokens || []);
  await sendToTokens(tokens, { title, body, data });
}

module.exports = { sendToTokens, notifyUser, notifyAllUsers };
