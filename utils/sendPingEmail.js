// utils/sendPingEmail.js
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendPingEmail({ to, goalPrompt, userName }) {
  const response = await resend.emails.send({
    from: process.env.FROM_EMAIL,
    to,
    subject: 'DailyPing: What’s your #1 goal today?',
    html: `
      <div style="font-family: sans-serif; padding: 1rem;">
        <h2>Hi${userName ? ` ${userName}` : ''},</h2>
        <p>${goalPrompt || 'What’s your #1 goal today?'}</p>
        <a href="https://dailyping.org/respond" style="display:inline-block; padding:0.75rem 1.5rem; background:#111; color:#fff; text-decoration:none; border-radius:5px;">Respond Now</a>
        <p style="margin-top:2rem; font-size:0.8rem; color:#999;">Powered by DailyPing</p>
      </div>
    `
  });

  return response;
}

module.exports = sendPingEmail;
