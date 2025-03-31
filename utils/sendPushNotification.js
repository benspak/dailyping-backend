// utils/sendPushNotification.js
const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:your-email@domain.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = function sendPushNotification(subscription, payload) {
  return webpush.sendNotification(subscription, JSON.stringify(payload));
};
