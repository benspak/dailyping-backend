const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:your-email@domain.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Sends a web push notification to the user's browser
 * @param {Object} subscription - Push subscription object from browser
 * @param {Object} payload - Must include title and body
 */
async function sendPushNotification(subscription, payload) {
  try {
    // Ensure payload is a proper JSON string
    const message = JSON.stringify({
      title: payload?.title || 'DailyPing',
      body: payload?.body || 'You have a new ping!',
    });

    await webpush.sendNotification(subscription, message);
    console.log('📬 Push notification sent:', message);
  } catch (err) {
    console.error('❌ Failed to send push notification:', err.message);
    throw err;
  }
}

module.exports = sendPushNotification;
