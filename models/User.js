// backend/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
  timezone: { type: String, default: 'America/New_York' },

  // Stripe + billing
  pro: {
    type: String,
    default: 'inactive', // instead of `false`
    enum: ['active', 'inactive', 'canceled', 'trialing'] // optional
  },
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String },

  // User preferences
  preferences: {
    pingTime: { type: String, default: '08:00' },         // HH:MM format
    deliveryMethod: { type: String, default: 'email' },   // email, sms, telegram
    tone: { type: String, default: 'gentle' },             // gentle, motivational, snarky
    dailyMode: { type: String, default: 'goal' },          // goal, intention, etc.
    weeklySummary: { type: Boolean, default: true }       // weekly summary email
  },

  // Streak tracking
  streak: {
    current: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
    lastEntryDate: { type: Date }
  },

  loginStreak: {
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastDate: { type: String, default: null }
  },

  // Admin flag
  isAdmin: { type: Boolean, default: false },

  // Push Notifications
  pushSubscription: {
  endpoint: String,
    keys: {
      p256dh: String,
      auth: String
    }
  },

  // Public profile
  public: {
    type: Boolean,
    default: false
  },

  // Needed to share goals
  username: {
    type: String,
    unique: true,
    sparse: true, // in case you don't require it immediately
    lowercase: true,
    trim: true
  },

  // User details
  bio: { type: String, default: 'No bio provided.' },
});

module.exports = mongoose.model('User', UserSchema);
