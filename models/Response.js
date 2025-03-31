// backend/models/Response.js
const mongoose = require('mongoose');

const ResponseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: { type: String, required: true },
  mode: { type: String, default: 'goal' },
  date: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  subTasks: [
    {
      text: String,
      done: { type: Boolean, default: false }
    }
  ]
});

module.exports = mongoose.model('Response', ResponseSchema);
