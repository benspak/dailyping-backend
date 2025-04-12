// backend/models/Goal.js
const mongoose = require('mongoose');

const SubTaskSchema = new mongoose.Schema({
  text: { type: String, required: true },
  completed: { type: Boolean, default: false },
  reminders: [{ type: String }] // 'HH:mm' format
});

const GoalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  mode: { type: String, default: 'goal' }, // could expand for other types later
  date: { type: String, required: true }, // 'YYYY-MM-DD' format
  reminders: [{ type: String }],
  subTasks: [SubTaskSchema],
  goalCompleted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  note: { type: String, default: '' },
});

module.exports = mongoose.model('Goal', GoalSchema);
