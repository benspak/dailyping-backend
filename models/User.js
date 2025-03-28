// backend/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
  timezone: { type: String, default: 'UTC' },
  preferences: {
    pingTime: { type: String, default: '08:00' },
    deliveryMethod: { type: String, default: 'email' },
    tone: { type: String, default: 'gentle' },
    dailyMode: { type: String, default: 'goal' },
    pro: { type: Boolean, default: false }
  },
  streak: {
    current: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
    lastEntryDate: { type: Date }
  }
});
module.exports = mongoose.model('User', UserSchema);
