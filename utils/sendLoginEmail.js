// backend/utils/sendLoginEmail.js
const { Resend } = require('resend');
const resendLogin = new Resend(process.env.RESEND_API_KEY);

async function sendLoginEmail(to, loginUrl) {
  return await resendLogin.emails.send({
    from: process.env.FROM_EMAIL,
    to,
    subject: 'Your DailyPing Login Link',
    html: `
      <div style="font-family: sans-serif; padding: 1rem;">
        <h2>Welcome back to DailyPing!</h2>
        <p>Click the button below to log in securely:</p>
        <a href="${loginUrl}" style="display:inline-block; padding:0.75rem 1.5rem; background:#111; color:#fff; text-decoration:none; border-radius:5px;">Log In</a>
        <p style="margin-top:2rem; font-size:0.8rem; color:#999;">This link will expire in 15 minutes.</p>
      </div>
    `
  });
}

module.exports = sendLoginEmail;
