// backend/models/Response.js
const mongoose = require('mongoose');

const ResponseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: String,
  mode: String,
  date: String,
  createdAt: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  subTasks: [
    {
      text: String,
      checked: { type: Boolean, default: false }
    }
  ]
});

module.exports = mongoose.model('Response', ResponseSchema);
