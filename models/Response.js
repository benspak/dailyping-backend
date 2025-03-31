// backend/models/Response.js
const mongoose = require('mongoose');

const SubTaskSchema = new mongoose.Schema({
  text: { type: String },
  checked: { type: Boolean, default: false }
}, { _id: false });

const ResponseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  mode: { type: String, default: 'goal' },
  date: { type: String },
  createdAt: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  subTasks: [SubTaskSchema]
});

module.exports = mongoose.model('Response', ResponseSchema);
