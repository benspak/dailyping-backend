require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cron = require('node-cron');
const axios = require('axios');
const { DateTime } = require('luxon');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const webpush = require('web-push');
const OpenAI = require("openai");
const moment = require('moment-timezone');

const app = express();
const port = process.env.PORT || 5555;

// Production CORS
const allowedOrigins = ['https://dailyping.org', 'https://stripe.com'];

 app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
 }));

// Allow all, only for development
// app.use(cors());

// Webhook must be above bodyParser and instances of app.use
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  // console.log('🚨 Webhook endpoint hit');
  // console.log('🧪 typeof req.body:', typeof req.body);
  // console.log('🧪 instanceof Buffer:', req.body instanceof Buffer);
  // console.log('🧪 Signature header:', req.headers['stripe-signature']);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    // console.log(event);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // console.log(`📬 Event received: ${event.type}`);
    // console.log('📥 Handling checkout.session.completed');
    // console.log('🧾 Session metadata:', session.metadata);
    // console.log('📧 Session email:', session.customer_email);
    // console.log('🔗 Session subscription:', session.subscription);
    const userId = session.metadata?.userId;
    const customerEmail = session.customer_email;

    try {
      let user = userId
        ? await User.findById(userId)
        : await User.findOne({ email: customerEmail });

      if (user) {
        user.pro = 'active';
        user.stripeCustomerId = session.customer;
        user.stripeSubscriptionId = session.subscription?.id || session.subscription;
        await user.save();
        // console.log('📦 Stripe session received:', session);
        console.log(`✅ Pro activated: ${user.username}`);
      }
    } catch (err) {
      console.error('❌ Webhook error:', err.message);
    }
  }

  res.json({ received: true });
});

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

// Open AI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Models
const User = require('./models/User');
const Ping = require('./models/Ping');
const Goal = require('./models/Goal.js');
const Project = require('./models/Project.js');
const Backlog = require('./models/Backlog.js');

// Utils
const sendPingEmail = require('./utils/sendPingEmail');
const sendLoginEmail = require('./utils/sendLoginEmail');
const sendPushNotification = require("./utils/sendPushNotification");
const { getPromptByTone } = require('./utils/tonePrompts');

// Cron
const processGoalReminders = require('./cron/process-reminders');

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

// Run goal reminders cron every minute
cron.schedule('* * * * *', async () => {
  await processGoalReminders();
}, {
  timezone: 'America/New_York'
});

// Run daily ping cron every minute
cron.schedule('* * * * *', async () => {
  // console.log("⏰ Running daily ping cron ...")
  try {
    // console.log("⏰ Sending daily ping post request ...")
    await axios.post(
      'https://api.dailyping.org/cron/daily-pings',
      {}, // empty body
      {
        headers: {
          'x-cron-secret': process.env.CRON_SECRET
        }
      }
    );
  } catch (err) {
    console.error('⏰ Ping cron failed:', err.message);
  }
}, { timezone: 'America/New_York' });

// Stripe sync cron every minute
// Enhanced Stripe sync block with logging for debugging pro activation
cron.schedule('* * * * *', async () => {
  // console.log('🔁 Running Stripe subscription sync...');
  try {
    const users = await User.find({ stripeSubscriptionId: { $exists: true } });

    for (let user of users) {
      try {
        const subId = user.stripeSubscriptionId?.trim();
        // console.log(`🔍 Checking subId for ${user.username}:`, subId);

        if (!subId) {
          if (user.pro === 'active') {
            user.pro = 'inactive';
            user.lastProEmailSentAt = new Date();
            await user.save();
            console.warn(`🛑 Downgraded ${user.username} due to missing subId`);
          }
          continue;
        }

        const sub = await stripe.subscriptions.retrieve(subId);
        // console.log(`📦 Subscription status for ${user.username}:`, sub.status);

        const isPro = ['active', 'trialing'].includes(sub.status);

        if (isPro) {
          if (user.pro !== 'active') {
            user.pro = 'active';
            user.lastProEmailSentAt = new Date();
            try {
              await user.save();
              console.log(`✅ Upgraded ${user.username} to Pro`);
            } catch (saveErr) {
              console.error(`❌ Failed to save pro status for ${user.username}:`, saveErr.message);
            }
          } else {
            // console.log(`ℹ️ ${user.username} already marked as Pro`);
          }
        } else {
          if (user.pro === 'active') {
            user.pro = 'inactive';
            user.lastProEmailSentAt = new Date();
            await user.save();
            console.warn(`🛑 Downgraded ${user.username} due to status: ${sub.status}`);
          }
        }
      } catch (err) {
        console.error(`❌ Stripe check failed for ${user.username}:`, err.message);
        if (err.message.includes('No such subscription') || err.code === 'resource_missing') {
          user.pro = 'inactive';
          user.lastProEmailSentAt = new Date();
          await user.save();
          console.warn(`🛑 Downgraded ${user.username} due to missing or invalid subscription`);
        }
      }
    }
  } catch (err) {
    console.error('❌ Stripe sync cron failed:', err.message);
  }
}, { timezone: 'America/New_York' });

// 🔁 1. Cron Job — Every Sunday @ 8 AM (EST)
cron.schedule('0 8 * * 0', async () => {
  try {
    await axios.post(
      'https://dailyping.org/cron/weekly-summary',
      {}, // empty body
      {
        headers: {
          'x-cron-secret': process.env.CRON_SECRET
        }
      }
    );
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

    // Send all necessary fields
    res.json({
      userId: user.id,
      email: user.email,
      streak: user.streak,
      pro: user.pro,
      preferences: user.preferences || {},
      timezone: user.timezone || 'America/New_York',
      isAdmin: user.isAdmin || false, // Needed for AdminPanel
      username: user.username || null,
      bio: user.bio,
      needsUsername: !user.username
    });

  } catch (err) {
    console.error('❌ Failed to load user:', err.message);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});


app.post('/billing/create-checkout-session', authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) return res.status(404).json({ error: 'User not found' });

  // Create a Stripe customer if one doesn't exist
  if (!user.stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user._id.toString() }
    });
    user.stripeCustomerId = customer.id;
    user.pro = 'active';
    await user.save();
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    customer: user.stripeCustomerId,
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }
    ],
    success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/billing/cancel`,
    metadata: {
      userId: user._id.toString()
    }
  });

  res.json({ url: session.url });
});

app.post('/api/goal', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { content, mode, subTasks = [], reminders = [], note, date } = req.body;
  const todayISO = new Date().toISOString().split('T')[0];

  try {
    // const existing = await Goal.findOne({ userId, date: todayISO });
    // if (existing) {
    //  return res.status(400).json({ error: 'Goal already submitted today.' });
    // }

    const user = await User.findById(userId);

    const cleanedSubTasks = subTasks.map(t => ({
      text: t.text?.trim(),
      reminders: user.pro === 'active' ? (t.reminders || []) : [],
      checked: false
    })).filter(t => t.text);

    const goal = new Goal({
      userId,
      content,
      mode,
      date,
      reminders: user.pro === 'active' ? reminders : [],
      subTasks: cleanedSubTasks,
      createdAt: new Date(),
      edited: false,
      note
    });

    await goal.save();

    // Update streak
    if (user) {
      const lastDate = user.streak.lastEntryDate?.toISOString().split('T')[0];
      if (lastDate === todayISO) {
        // already updated today
      } else if (lastDate === getYesterdayISO()) {
        user.streak.current += 1;
      } else {
        user.streak.current = 1;
      }
      user.streak.lastEntryDate = new Date();
      user.streak.max = Math.max(user.streak.max, user.streak.current);
      await user.save();
    }

    res.json(goal);
  } catch (err) {
    console.error('❌ Error creating goal:', err.message);
    res.status(500).json({ error: 'Failed to submit goal' });
  }
});

app.post('/api/streak/update', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const userTimezone = user.timezone || process.env.SERVER_TIMEZONE || 'America/New_York';
    const now = moment().tz(userTimezone);
    const today = now.format('YYYY-MM-DD');
    const yesterday = now.clone().subtract(1, 'day').format('YYYY-MM-DD');

    const lastEntry = user.streak?.lastEntryDate?.toISOString().split('T')[0];

    if (lastEntry === today) {
      return res.status(200).json({ message: 'Already updated today' });
    } else if (lastEntry === yesterday) {
      user.streak.current += 1;
    } else {
      user.streak.current = 1;
    }

    user.streak.lastEntryDate = now.toDate();
    user.streak.max = Math.max(user.streak.max || 0, user.streak.current);
    await user.save();

    res.json({
      message: 'Streak updated',
      current: user.streak.current,
      max: user.streak.max
    });
  } catch (err) {
    console.error('❌ Failed to update streak:', err.message);
    res.status(500).json({ error: 'Failed to update streak' });
  }
});

// Update existing goal
app.put('/api/goal/:id', authenticateToken, async (req, res) => {
  try {
    const { content, reminders = [], subTasks = [], note, date } = req.body;

    const updated = await Goal.findById(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Goal not found.' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(403).json({ error: 'Unauthorized' });

    updated.content = content;
    updated.reminders = user.pro === 'active' ? reminders : [];

    updated.subTasks = (subTasks || []).map(t => ({
      text: t.text?.trim(),
      reminders: user.pro === 'active' ? (t.reminders || []) : [],
      completed: false
    })).filter(t => t.text);

    updated.edited = true;
    updated.date = date;
    updated.note = note;

    await updated.save();
    res.json({ success: true, updated });
  } catch (err) {
    console.error('❌ PUT /goal/:id error:', err);
    res.status(500).json({ error: 'Failed to update goal.' });
  }
});

app.get('/api/goals/all', authenticateToken, async (req, res) => {
  const goals = await Goal.find({ userId: req.user.id }).sort({ date: -1 });
  res.json(goals);
});

app.get('/api/goals/today', authenticateToken, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const existing = await Goal.findOne({ userId: req.user.id, date: today });
  res.json(existing
  ? {
      alreadySubmitted: true,
      content: existing.content,
      _id: existing._id,
      reminders: existing.reminders || [],
      subTasks: existing.subTasks || [],
      note: existing.note
    }
  : { alreadySubmitted: false });
});

app.post('/api/preferences', authenticateToken, async (req, res) => {
  try {
    const { pingTime, tone, timezone, weeklySummary } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).json({ error: 'User not found' });

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
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    console.warn('❌ Invalid CRON secret for /cron/daily-pings');
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const users = await User.find({});
    const results = [];

    for (const user of users) {
      const timezone = user.timezone || 'America/New_York';
      const prefTime = user.preferences?.pingTime || '08:00';
      const tone = user.preferences?.tone || 'gentle';

      const userNow = DateTime.now().setZone(timezone);
      const currentUserHHMM = userNow.toFormat('HH:mm');

      if (currentUserHHMM !== prefTime) continue;

      const goalPrompt = getPromptByTone(tone);

      const ping = new Ping({ userId: user._id, sentAt: new Date(), deliveryMethod: 'email', status: 'sent' });
      await ping.save();

      // Email
      try {
        await sendPingEmail({ to: user.email, userName: user.name || '', tone, goalPrompt });
        // console.log(`📧 Email sent to ${user.email}`);
      } catch (error) {
        ping.status = 'failed';
        await ping.save();
        results.push({ user: user.email, email: false, push: false });
        continue;
      }

      // Push
      let pushSent = false;
      if (user.pushSubscription?.endpoint) {
        try {
          // console.log('📬 Subscription:', user.pushSubscription);
          await sendPushNotification(user.pushSubscription, {
            title: 'DailyPing',
            body: goalPrompt
          });
          console.log(`📬 Push sent to ${user.email}`);
          pushSent = true;
        } catch (pushErr) {
          console.warn(`⚠️ Push failed for ${user.email}:`, pushErr.message);
        }
      }

      results.push({ user: user.email, email: true, push: pushSent });
    }

    res.json({ sent: results });
  } catch (err) {
    console.error('❌ Cron job failed:', err.message);
    res.status(500).json({ error: 'Cron job failed', details: err.message });
  }
});

app.post('/cron/weekly-summary', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    console.warn('❌ Invalid CRON secret for /cron/weekly-summary');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const users = await User.find({ pro: true });
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const results = [];

  for (const user of users) {
    try {
      const goals = await Goal.find({
        userId: user._id,
        createdAt: { $gte: startOfWeek }
      }).sort({ date: 1 });

      const content = goals.map(r => `<li><strong>${r.date}</strong>: ${r.content}</li>`).join('');

      const html = `
        <div style="font-family:sans-serif;padding:1rem;">
          <h2>Your Weekly Summary</h2>
          <p>You completed <strong>${goals.length}</strong> days of goals this week.</p>
          <ul>${content}</ul>
          <p><strong>Goal streak:</strong> ${user.streak?.current ?? 0} 🔥</p>
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
    const { title, body } = req.body;

    if (!user || !user.pushSubscription || !user.pushSubscription.endpoint) {
      console.error('❌ No valid push subscription found for user:', user?.email);
      return res.status(400).json({ error: 'No valid push subscription found.' });
    }

    const payload = JSON.stringify({
      title: title || 'Test Push',
      body: body || '👋 Hello from DailyPing! Push is working.'
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

// Toggle completion for a specific sub-task
  app.post('/api/goal/toggle-subtask', authenticateToken, async (req, res) => {
    const { goalId, index, completed } = req.body;

    if (!goalId || typeof index !== 'number') {
      return res.status(400).json({ error: 'Missing goalId or index' });
    }

    try {
      const goal = await Goal.findById(goalId);
      if (!goal || goal.userId.toString() !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (!Array.isArray(goal.subTasks) || index >= goal.subTasks.length) {
        return res.status(400).json({ error: 'Invalid subtask index' });
      }

      goal.subTasks[index].completed = completed;
      await goal.save();

      res.json({ success: true, updated: goal.subTasks[index] });
    } catch (err) {
      console.error('❌ Subtask update error:', err.message);
      res.status(500).json({ error: 'Failed to update subtask' });
    }
  });

  app.post('/api/goal/toggle-goal', authenticateToken, async (req, res) => {
  const { goalId, completed } = req.body;

  if (!goalId || typeof completed !== 'boolean') {
    return res.status(400).json({ error: 'Missing or invalid data' });
  }

  try {
    const goal = await Goal.findById(goalId);
    if (!goal || goal.userId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    goal.goalCompleted = completed;
    await goal.save();

    res.json({ success: true, updated: goal });
  } catch (err) {
    console.error('❌ Goal completion update error:', err.message);
    res.status(500).json({ error: 'Failed to update goal completion' });
  }
});

// Set username (once, after login)
app.post('/api/user/set-username', authenticateToken, async (req, res) => {
  const { username } = req.body;
  const trimmed = (username || '').trim().toLowerCase();

  if (!trimmed || trimmed.length < 3 || trimmed.length > 20 || !/^[a-z0-9_]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Username must be 3–20 characters, lowercase letters, numbers or underscores only.' });
  }

  try {
    const existing = await User.findOne({ username: trimmed });
    if (existing) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.username) return res.status(403).json({ error: 'Username already set. Cannot change it.' });

    user.username = trimmed;
    await user.save();

    res.json({"success": true, message: "✅ Username set successfully." });
  } catch (err) {
    console.error('❌ Failed to set username:', err.message);
    res.status(500).json({ error: 'Failed to set username' });
  }
});

app.get('/api/public/:username/:date', async (req, res) => {
  const { username, date } = req.params;
  const user = await User.findOne({ username });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const goal = await Goal.findOne({ userId: user._id, date });
  if (!goal) return res.status(404).json({ error: 'No goal found' });

  res.json({
    username,
    date,
    content: goal.content,
    subTasks: goal.subTasks,
    completed: goal.goalCompleted,
  });
});

// Get public goal by username and date
app.get('/api/public-goal/:username/:date', async (req, res) => {
  const { username, date } = req.params;

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Date YYYY-MM-DD
    const goal = await Goal.findOne({ userId: user._id, date });
    if (!goal) return res.status(404).json({ error: 'Goal not found for that date' });

    res.json({
      username: user.username,
      date: goal.date,
      content: goal.content,
      subTasks: goal.subTasks || [],
      edited: goal.edited || false
    });
  } catch (err) {
    console.error('❌ Failed to fetch public goal:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET public user profile and public goals
app.get('/public/user/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const publicGoals = await Goal.find({
      userId: user._id,
      isPublic: true
    }).sort({ date: -1 }).limit(10); // or whatever number you want

    // Only expose safe fields
    res.json({
      user: {
        username: user.username,
        bio: user.bio || 'No bio provided.',
        streak: user.streak || {},
        pro: user.pro || 'inactive'
      },
      goals: publicGoals
    });

  } catch (err) {
    console.error('❌ Error fetching public profile:', err.message);
    res.status(500).json({ error: 'Failed to load public profile' });
  }
});

// Get all projects for the logged-in user
app.get("/api/projects", authenticateToken, async (req, res) => {
  const projects = await Project.find({ userId: req.user._id });
  res.json(projects);
});

// Get a single project by ID
app.get("/api/projects/:id", authenticateToken, async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
  if (!project) return res.status(404).json({ message: "Not found" });
  res.json(project);
});

// Create a new project
app.post("/api/projects", authenticateToken, async (req, res) => {
  // console.log("POST /api/projects hit!", req.body);
  const { title, description, goalIds, users } = req.body;
  const project = new Project({
    userId: req.user._id,
    title,
    description,
    goalIds,
    users
  });
  await project.save();
  res.status(201).json(project);
});

// Update an existing project
app.put("/api/projects/:id", authenticateToken, async (req, res) => {
  const { title, description, goalIds, users } = req.body;
  const project = await Project.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { title, description, goalIds, users },
    { new: true }
  );
  if (!project) return res.status(404).json({ message: "Not found" });
  res.json(project);
});

app.get("/api/goal/:id", authenticateToken, async (req, res) => {
  const goal = await Goal.findOne({ _id: req.params.id });
  if (!goal) return res.status(404).json({ message: "Not found" });
  res.json(goal);
});

app.delete('/api/goal/:id', authenticateToken, async (req, res) => {
  try {
    const goal = await Goal.findById(req.params.id);
    if (!goal || goal.userId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    await goal.deleteOne();
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to delete goal:', err.message);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// Backlog Routes
app.get("/api/backlog", authenticateToken, async (req, res) => {
  const items = await Backlog.find({ userId: req.user.id });
  res.json(items);
});

app.post("/api/backlog", authenticateToken, async (req, res) => {
  const { title, note, date } = req.body;
  const item = new Backlog({
    userId: req.user.id,
    title,
    note,
    date
  });

  //console.log("Authenticated user:", req.user);
  //console.log("Body received:", req.body);
  // console.log("Received POST /backlog:", { title, note, date });
  //console.log("req.user:", req.user);

  try {
    await item.save();
    res.status(201).json(item);
  } catch (err) {
    console.error("Backlog creation failed:", err);
    res.status(500).json({ error: "Failed to create backlog item" });
  }
});

app.delete('/api/backlog/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const deleted = await Backlog.findOneAndDelete({ _id: id, userId });
    if (!deleted) {
      return res.status(404).json({ message: "Item not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// OpenAI Suggest Subtasks
app.post('/api/ai/suggest-subtasks', async (req, res) => {
  const { goal, existing = [] } = req.body;

  if (!goal) return res.status(400).json({ error: 'Goal is required' });

  try {
    const prompt = `Goal: "${goal}"\n` +
      (existing.length > 0
        ? `Current subtasks: ${existing.join(", ")}\n`
        : `There are no current subtasks.\n`) +
      `Suggest 3 helpful, creative new subtasks to support this goal, avoiding duplication. Each subtask should be independent and actionable. Actionable sub tasks take less than 10 minutes to complete. Return ONLY a JSON array of strings.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'user', content: prompt },
        {
          role: 'system',
          content: 'You are a helpful productivity assistant for ADHD users. If they enter a short goal and some sub tasks, your directive is to be creative and come up with related suggestions for sub tasks to help the user achieve the goal.'
        }
      ],
      max_tokens: 42,
    });

    const message = completion.choices[0].message.content;

    let subtasks;
    try {
      subtasks = JSON.parse(message);
    } catch {
      subtasks = message
        .split('\n')
        .filter(Boolean)
        .map(line => line.replace(/^\d+\.\s*/, '').trim());
    }

    res.json({ subtasks });
  } catch (err) {
    console.error('❌ OpenAI error in /suggest-subtasks:', err);
    res.status(500).json({ error: 'AI failed to generate subtasks.' });
  }
});


// OpenAI Suggest Note
{/*
app.post('/api/ai/suggest-note', authenticateToken, async (req, res) => {
  const { goal, subtasks } = req.body;

  if (!goal) return res.status(400).json({ error: 'Goal text is required' });

  try {
    const prompt = `Provide a helpful, detailed note for the following goal and subtasks.
Goal: "${goal}"
Subtasks: ${subtasks?.length ? subtasks.join(', ') : 'None'}

Make the note actionable and motivating, tailored for someone with ADHD. Keep the note less than 3000 characters.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful productivity assistant for ADHD users. If they enter a short goal and some subtasks, your directive is to be creative and come up with a detailed implementation note to help the user achieve the goal and subtasks.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 3000,
    });

    const message = response.choices[0].message.content;
    res.json({ note: message });
  } catch (err) {
    console.error('AI error (suggest-note):', err);
    res.status(500).json({ error: 'Failed to generate note' });
  }
});
*/}

// GET /api/stats/today
app.get('/api/stats/today', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const userTimezone = user.timezone || 'America/New_York';

    const startOfDay = moment().tz(userTimezone).startOf('day').toDate();
    const endOfDay = moment().tz(userTimezone).endOf('day').toDate();

    const goalsCompleted = await Goal.countDocuments({
      userId: user._id,
      goalCompleted: true,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    res.json({ goalsCompleted });
  } catch (err) {
    console.error('Error getting today stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));
