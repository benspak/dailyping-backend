const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Choose ping prompt based on tone
function getPromptByTone(tone = 'gentle') {
  switch (tone) {
    case 'motivational':
      return "🔥 Let’s crush the day — what’s your #1 goal?";
    case 'snarky':
      return "You again? Better not waste today. What’s your top goal?";
    case 'gentle':
    default:
      return "What’s your #1 goal today?";
  }
}

async function sendPingEmail({ to, userName, goalPrompt, tone = 'gentle' }) {
  const prompt = goalPrompt || getPromptByTone(tone);

  const response = await resend.emails.send({
    from: process.env.FROM_EMAIL,
    to,
    subject: 'DailyPing: What’s your #1 goal today?',
    html: `
      <div style="font-family: sans-serif; padding: 1rem;">
        <h2>Hi${userName ? ` ${userName}` : ''},</h2>
        <p>${prompt}</p>
        <a href="https://dailyping.org/respond" style="display:inline-block; padding:0.75rem 1.5rem; background:#111; color:#fff; text-decoration:none; border-radius:5px;">Respond Now</a>
        <p style="margin-top:2rem; font-size:0.8rem; color:#999;">Powered by DailyPing</p>
      </div>
    `
  });

  return response;
}

module.exports = sendPingEmail;
