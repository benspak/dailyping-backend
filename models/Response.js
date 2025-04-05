// backend/models/Response.js
const mongoose = require('mongoose');

const subTaskSchema = new mongoose.Schema({
  text: { type: String, required: true },
  completed: { type: Boolean, default: false }
});

const responseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  mode: { type: String, default: 'goal' },
  date: { type: String, required: true }, // YYYY-MM-DD
  createdAt: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  goalCompleted: { type: Boolean, default: false },
  subTasks: [subTaskSchema]
});

module.exports = mongoose.model('Response', responseSchema);
