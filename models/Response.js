// backend/models/Response.js
const mongoose = require('mongoose');

const ResponseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  mode: { type: String, default: 'goal' },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false }
});
module.exports = mongoose.model('Response', ResponseSchema);
