const webpush = require('web-push');

// Set VAPID details for push notifications
webpush.setVapidDetails(
  'mailto:your@email.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Match email tone logic
function getPromptByTone(tone = 'gentle') {
  switch (tone) {
    case 'motivational':
      return "🔥 You’ve got this! What’s one goal for today?";
    case 'snarky':
      return "Back again? Let’s make today count — what’s your goal?";
    case 'gentle':
    default:
      return "What’s one meaningful thing you’d like to do today?";
  }
}

async function sendPushNotification(subscription, { tone = 'gentle', title = 'DailyPing', body = '' } = {}) {
  const prompt = body || getPromptByTone(tone);

  const payload = JSON.stringify({
    title,
    body: prompt
  });

  return webpush.sendNotification(subscription, payload);
}

module.exports = sendPushNotification;
