const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Inclusive + expressive tone prompts
function getPromptByTone(tone = 'gentle') {
  switch (tone) {
    case 'motivational':
      return "🔥 You’ve got this! What’s the one goal you want to accomplish today?";
    case 'snarky':
      return "Back again? Let’s make today count — what’s your top goal?";
    case 'gentle':
    default:
      return "Hi there. What’s one meaningful thing you’d like to do today?";
  }
}

async function sendPingEmail({ to, userName, goalPrompt, tone = 'gentle' }) {
  console.log('🚀 Sending email with tone:', tone);
  const prompt = typeof goalPrompt === 'string' ? goalPrompt : getPromptByTone(tone);

  const response = await resend.emails.send({
    from: process.env.FROM_EMAIL,
    to,
    subject: 'DailyPing: Your goal check-in',
    html: `
      <div style="font-family: sans-serif; padding: 1rem;">
        <h2>Hi${userName ? ` ${userName}` : ''},</h2>
        <p>${prompt}</p>
        <a href="https://dailyping.org/respond" style="display:inline-block; padding:0.75rem 1.5rem; background:#111; color:#fff; text-decoration:none; border-radius:5px;">Respond Now</a>
        <p style="margin-top:2rem; font-size:0.8rem; color:#999;">You're doing great. — DailyPing</p>
      </div>
    `
  });

  return response;
}

module.exports = sendPingEmail;
