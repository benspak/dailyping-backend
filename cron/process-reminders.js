// cron/process-reminders.js
const { DateTime } = require("luxon");
const User = require("../models/User");
const Response = require("../models/Response");
const sendPingEmail = require("../utils/sendPingEmail");
const sendPushNotification = require("../utils/sendPushNotification");

async function processGoalReminders() {
  const now = DateTime.now().setZone("America/New_York").toFormat("HH:mm");

  const responses = await Response.find({
    $or: [
      { "reminders": { $exists: true, $ne: [] } },
      { "subTasks.reminders": { $exists: true, $ne: [] } }
    ]
  }).populate("userId");

  for (const response of responses) {
    const { userId: user } = response;
    const tz = user.timezone || "America/New_York";
    const localNow = DateTime.now().setZone(tz).toFormat("HH:mm");

    // 🔔 Goal Reminder
    if ((response.reminders || []).includes(localNow)) {
      await sendGoalReminder(user, response.content);
    }

    // 🔔 Subtask Reminders
    (response.subTasks || []).forEach(async (t) => {
      if ((t.reminders || []).includes(localNow)) {
        await sendGoalReminder(user, t.text);
      }
    });
  }
}

async function sendGoalReminder(user, text) {
  const goalPrompt = `Reminder: ${text}`;
  try {
    await sendPingEmail({ to: user.email, goalPrompt });
    if (user.pushSubscription) {
      await sendPushNotification(user.pushSubscription, {
        title: "DailyPing Reminder",
        body: goalPrompt
      });
    }
    console.log(`✅ Reminder sent to ${user.username}`);
  } catch (err) {
    console.error(`❌ Failed reminder for ${user.username}`, err.message);
  }
}

module.exports = processGoalReminders;
