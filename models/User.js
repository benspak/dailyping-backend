// backend/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
  timezone: { type: String, default: 'UTC' },

  // Stripe + billing
  pro: { type: Boolean, default: false },
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

  // Admin flag
  isAdmin: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', UserSchema);
