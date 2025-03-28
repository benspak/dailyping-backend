// backend/models/Ping.js
const mongoose = require('mongoose');

const PingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sentAt: { type: Date, default: Date.now },
  deliveryMethod: { type: String, default: 'email' },
  status: { type: String, default: 'sent' }
});
module.exports = mongoose.model('Ping', PingSchema);
