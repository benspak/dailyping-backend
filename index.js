// backend/index.js
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

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Models
const User = require('./models/User');
const Ping = require('./models/Ping');
const Response = require('./models/Response');
const sendPingEmail = require('./utils/sendPingEmail');
const sendLoginEmail = require('./utils/sendLoginEmail');

// Utility function to get yesterday's ISO date
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

// Run every day at 7 AM EST
cron.schedule('5 7 * * *', async () => {
  try {
    console.log('⏰ Running daily ping cron at 7:05 AM EST');
    await axios.post('/cron/daily-pings'); // adjust if deployed
  } catch (err) {
    console.error('Cron failed:', err.message);
  }
}, {
  timezone: 'America/New_York'
});

// Routes
app.get('/', (req, res) => {
  res.send('DailyPing API is running');
});

// Auth - Request magic link
app.post('/auth/request-login', async (req, res) => {
  const { email } = req.body;
  const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const loginUrl = `/auth/verify?token=${token}`;
  await sendLoginEmail(email, loginUrl);
  res.json({ message: 'Magic login link sent.' });
});

// Auth - Verify token
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
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
});

// Auth - Get current user data
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Billing - Create Stripe checkout session
app.post('/billing/create-checkout-session', authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    customer_email: user.email,
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/billing/cancel`,
    metadata: {
      userId: user._id.toString()
    }
  });
  res.json({ url: session.url });
});

// Stripe webhook
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
    const userId = session.metadata.userId;
    const subscriptionId = session.subscription;

    await User.findByIdAndUpdate(userId, {
      pro: true,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: subscriptionId
    });
  }

  res.json({ received: true });
});

// Create ping manually (for testing)
app.post('/api/pings', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const ping = new Ping({ userId, sentAt: new Date(), deliveryMethod: 'email', status: 'sent' });
  await ping.save();
  res.json(ping);
});

// Get all responses for the logged-in user (most recent first)
app.get('/api/responses/all', authenticateToken, async (req, res) => {
  try {
    const responses = await Response.find({ userId: req.user.id })
      .sort({ date: -1 });
    res.json(responses);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch responses' });
  }
});

app.get('/api/responses/today', authenticateToken, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const existing = await Response.findOne({
    userId: req.user.id,
    date: today
  });

  if (existing) {
    return res.json({
      alreadySubmitted: true,
      content: existing.content
    });
  } else {
    return res.json({ alreadySubmitted: false });
  }
});

// Submit response and update streak logic
app.post('/api/response', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { content, mode } = req.body;
  const todayISO = new Date().toISOString().split('T')[0];

  const response = new Response({
    userId,
    content,
    mode,
    date: todayISO,
    createdAt: new Date(),
    edited: false
  });
  await response.save();

  const user = await User.findById(userId);
  if (user) {
    const lastDate = user.streak.lastEntryDate ? user.streak.lastEntryDate.toISOString().split('T')[0] : null;

    if (lastDate === todayISO) {
      // Already submitted today, do nothing
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

// CRON: Send daily pings to all users
app.post('/cron/daily-pings', async (req, res) => {
  try {
    const users = await User.find({});
    const results = [];

    for (const user of users) {
      const ping = new Ping({ userId: user._id, sentAt: new Date(), deliveryMethod: 'email', status: 'sent' });
      await ping.save();

      try {
        const emailRes = await sendPingEmail({ to: user.email, goalPrompt: "What’s your #1 goal today?" });
        results.push({ user: user.email, success: true });
      } catch (error) {
        ping.status = 'failed';
        await ping.save();
        results.push({ user: user.email, success: false, error: error.message });
      }
    }

    res.json({ sent: results });
  } catch (err) {
    res.status(500).json({ error: 'Cron job failed', details: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

app.post('/test/send-ping', async (req, res) => {
  const { to, userName, goalPrompt } = req.body;
  try {
    const result = await sendPingEmail({ to, userName, goalPrompt });
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
