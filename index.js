require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParserRaw = require('body-parser');
const cron = require('node-cron');
const axios = require('axios');
const { DateTime } = require('luxon');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const webpush = require('web-push');

const app = express();
const port = process.env.PORT || 5555;

app.use(cors());
app.use(bodyParser.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

// Push Notifications
webpush.setVapidDetails(
  'mailto:your@email.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Models
const User = require('./models/User');
const Ping = require('./models/Ping');
const Response = require('./models/Response');
const sendPingEmail = require('./utils/sendPingEmail');
const sendLoginEmail = require('./utils/sendLoginEmail');

function getYesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Run daily ping cron every minute
cron.schedule('* * * * *', async () => {
  // console.log("⏰ Running daily ping cron ...")
  try {
    // console.log("⏰ Sending daily ping post request ...")
    await axios.post('https://api.dailyping.org/cron/daily-pings');
  } catch (err) {
    console.error('⏰ Ping cron failed:', err.message);
  }
}, { timezone: 'America/New_York' });

// Stripe sync cron at 7:15 AM EST
cron.schedule('15 7 * * *', async () => {
  console.log('🔁 Running daily Stripe subscription sync...');
  try {
    const users = await User.find({ stripeSubscriptionId: { $exists: true } });
    for (const user of users) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        const isActive = ['active', 'trialing'].includes(sub.status);
        if (user.pro !== isActive) {
          user.pro = isActive;
          await user.save();
          console.log(`🔄 Updated ${user.email} → pro: ${isActive}`);
        }
      } catch (err) {
        console.error(`❌ Stripe check failed for ${user.email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Stripe sync cron failed:', err.message);
  }
}, { timezone: 'America/New_York' });

// 🔁 1. Cron Job — Every Sunday @ 8 AM (EST)
cron.schedule('0 8 * * 0', async () => {
  try {
    await axios.post(`${process.env.API_URL || 'http://localhost:5000'}/cron/weekly-summary`);
  } catch (err) {
    console.error('❌ Weekly summary cron failed:', err.message);
  }
}, {
  timezone: 'America/New_York'
});


// --- Routes ---

app.get('/', (req, res) => res.send('DailyPing API is running'));

app.post('/auth/request-login', async (req, res) => {
  const { email } = req.body;
  const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const loginUrl = `https://dailyping.org/auth/verify?token=${token}`;
  await sendLoginEmail(email, loginUrl);
  res.json({ message: 'Magic login link sent.' });
});

app.post('/auth/verify', async (req, res) => {
  const { token } = req.body;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let user = await User.findOne({ email: decoded.email });
    if (!user) {
      user = new User({ email: decoded.email });
      await user.save();
    }
    const accessToken = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token: accessToken, user });
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
});

app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // ✅ Sync Pro status with Stripe
    if (user.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        const isActive = sub.status === 'active' || sub.status === 'trialing';
        if (user.pro !== isActive) {
          user.pro = isActive;
          await user.save();
          console.log(`🔄 Pro status synced for ${user.email}: ${isActive}`);
        }
      } catch (err) {
        console.error('⚠️ Stripe subscription lookup failed:', err.message);
      }
    }

    // ✅ Remove legacy "preferences.pro" if present
    if (user.preferences?.pro !== undefined) {
      delete user.preferences.pro;
      await user.save();
    }

    // ✅ Send all necessary fields
    res.json({
      email: user.email,
      streak: user.streak,
      pro: user.pro,
      preferences: user.preferences || {},
      timezone: user.timezone || 'UTC',
      isAdmin: user.isAdmin || false // ✅ Needed for AdminPanel
    });

  } catch (err) {
    console.error('❌ Failed to load user:', err.message);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});


app.post('/billing/create-checkout-session', authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    customer_email: user.email,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/billing/cancel`,
    metadata: { userId: user._id.toString() }
  });
  res.json({ url: session.url });
});

app.post('/webhook', bodyParserRaw.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const customerEmail = session.customer_email;

    try {
      let user = userId
        ? await User.findById(userId)
        : await User.findOne({ email: customerEmail });

      if (user) {
        user.pro = true;
        user.stripeCustomerId = session.customer;
        user.stripeSubscriptionId = session.subscription;
        await user.save();
        console.log(`✅ Pro activated: ${user.email}`);
      }
    } catch (err) {
      console.error('❌ Webhook error:', err.message);
    }
  }

  res.json({ received: true });
});

app.post('/api/response', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { content, mode } = req.body;
  const todayISO = new Date().toISOString().split('T')[0];

  const response = new Response({ userId, content, mode, date: todayISO, createdAt: new Date(), edited: false });
  await response.save();

  const user = await User.findById(userId);
  if (user) {
    const lastDate = user.streak.lastEntryDate?.toISOString().split('T')[0] ?? null;
    if (lastDate === todayISO) {
      // no change
    } else if (lastDate === getYesterdayISO()) {
      user.streak.current += 1;
    } else {
      user.streak.current = 1;
    }
    user.streak.lastEntryDate = new Date();
    user.streak.max = Math.max(user.streak.max, user.streak.current);
    await user.save();
  }

  res.json(response);
});

app.get('/api/responses/all', authenticateToken, async (req, res) => {
  const responses = await Response.find({ userId: req.user.id }).sort({ date: -1 });
  res.json(responses);
});

app.get('/api/responses/today', authenticateToken, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const existing = await Response.findOne({ userId: req.user.id, date: today });
  res.json(existing
    ? { alreadySubmitted: true, content: existing.content }
    : { alreadySubmitted: false });
});

app.post('/api/preferences', authenticateToken, async (req, res) => {
  try {
    const { pingTime, tone, timezone, weeklySummary } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.pro) return res.status(403).json({ error: 'Pro required' });

    const isValidTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(pingTime);
    if (pingTime && !isValidTime) {
      return res.status(400).json({ error: 'Invalid time format. Use HH:MM (24h).' });
    }

    if (!user.preferences) user.preferences = {};
    if (pingTime) user.preferences.pingTime = pingTime;
    if (tone) user.preferences.tone = tone;
    if (timezone) user.timezone = timezone;
    if (weeklySummary !== undefined) user.preferences.weeklySummary = weeklySummary;

    await user.save();
    res.json({ message: 'Preferences updated', preferences: user.preferences, timezone: user.timezone });
  } catch (err) {
    console.error('❌ Failed to update preferences:', err.message);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

app.post('/cron/daily-pings', async (req, res) => {
  try {
    const users = await User.find({});
    const results = [];

    for (const user of users) {
      const timezone = user.timezone || 'UTC';
      const prefTime = user.preferences?.pingTime || '08:00';
      const now = DateTime.now().setZone(timezone);
      const currentUserHHMM = now.toFormat('HH:mm');

      // Only continue if current time matches preferred time
      if (currentUserHHMM !== prefTime) continue;

      // Check if user already received a ping today in their timezone
      const today = now.toISODate();
      const alreadyPinged = await Ping.findOne({
        userId: user._id,
        sentAt: {
          $gte: DateTime.fromISO(today, { zone: timezone }).startOf('day').toJSDate(),
          $lte: DateTime.fromISO(today, { zone: timezone }).endOf('day').toJSDate()
        }
      });

      if (alreadyPinged) {
        console.log(`⏱ Already pinged today: ${user.email}`);
        continue;
      }

      const ping = new Ping({
        userId: user._id,
        sentAt: new Date(),
        deliveryMethod: 'email',
        status: 'sent'
      });

      await ping.save();

      try {
        await sendPingEmail({
          to: user.email,
          userName: user.name || '',
          tone: user.preferences?.tone
        });

        console.log(`🚀 Ping sent to ${user.email} at ${currentUserHHMM} (${timezone})`);
        results.push({ email: user.email, sent: true });
      } catch (error) {
        ping.status = 'failed';
        await ping.save();
        console.error(`❌ Email failed for ${user.email}:`, error.message);
        results.push({ email: user.email, sent: false, error: error.message });
      }
    }

    res.json({ sent: results });
  } catch (err) {
    console.error('❌ Cron job failed:', err.message);
    res.status(500).json({ error: 'Cron job failed', details: err.message });
  }
});

app.post('/cron/weekly-summary', async (req, res) => {
  const users = await User.find({ pro: true });

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const results = [];

  for (const user of users) {
    try {
      const responses = await Response.find({
        userId: user._id,
        createdAt: { $gte: startOfWeek }
      }).sort({ date: 1 });

      const content = responses.map(r => `<li><strong>${r.date}</strong>: ${r.content}</li>`).join('');

      const html = `
        <div style="font-family:sans-serif;padding:1rem;">
          <h2>Your Weekly Summary</h2>
          <p>You completed <strong>${responses.length}</strong> days of goals this week.</p>
          <ul>${content}</ul>
          <p><strong>Current streak:</strong> ${user.streak?.current ?? 0} 🔥</p>
          <p>Keep the momentum going!</p>
        </div>
      `;

      await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: user.email,
        subject: 'Your Weekly Ping Summary',
        html
      });

      results.push({ email: user.email, success: true });
    } catch (err) {
      console.error(`❌ Summary email failed for ${user.email}:`, err.message);
      results.push({ email: user.email, success: false, error: err.message });
    }
  }

  res.json({ status: 'complete', results });
});

// Feedback endpoint
app.post('/api/feedback', authenticateToken, async (req, res) => {
  const { subject, feedback } = req.body;
  const user = await User.findById(req.user.id);

  if (!subject || !feedback) {
    return res.status(400).json({ error: 'Missing subject or feedback' });
  }

  try {
    const result = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: 'benvspak@gmail.com',
      subject: `[DailyPing Feedback] ${subject}`,
      html: `
        <div style="font-family: sans-serif; line-height: 1.6;">
          <h2>New Feedback</h2>
          <p><strong>From:</strong> ${user.email}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Message:</strong></p>
          <blockquote>${feedback.replace(/\n/g, '<br>')}</blockquote>
        </div>
      `
    });

    console.log('✅ Feedback email sent via Resend');
    res.json({ success: true, result });
  } catch (err) {
    console.error('❌ Resend error:', err.message);
    res.status(500).json({ error: 'Failed to send feedback' });
  }
});

// Send a push notification manually
app.post('/test/send-push', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user || !user.pushSubscription || !user.pushSubscription.endpoint) {
      console.error('❌ No valid push subscription found for user:', user?.email);
      return res.status(400).json({ error: 'No valid push subscription found.' });
    }

    const payload = JSON.stringify({
      title: 'Test Push',
      body: '👋 Hello from DailyPing! Push is working.'
    });

    await webpush.sendNotification(user.pushSubscription, payload);

    res.json({ success: true, message: 'Test push sent' });

  } catch (err) {
    console.error('❌ Push send error:', err.message);
    res.status(500).json({ error: 'Failed to send push notification', details: err.message });
  }
});


// Save user push subscription
app.post('/api/push/subscribe', authenticateToken, async (req, res) => {
  try {
    const { subscription } = req.body;

    // ✅ Add this log here
    // console.log('🔍 Subscription received:', subscription);

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      console.error('❌ Invalid subscription:', subscription);
      return res.status(400).json({ error: 'Invalid subscription format' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.pushSubscription = subscription;
    await user.save();

    // console.log('📬 Push subscription saved for', user.email);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to save push subscription:', err.message);
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
});

app.get('/admin/push-subscription', authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user?.isAdmin) return res.status(403).json({ error: 'Admin only' });

  res.json({ email: user.email, pushSubscription: user.pushSubscription });
});

app.listen(port, () => console.log(`Server running on port ${port}`));
