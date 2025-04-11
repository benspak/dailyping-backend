const mongoose = require('mongoose');
const { Schema } = mongoose;

const queueSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now },
  convertedToGoal: { type: Boolean, default: false }
});

module.exports = mongoose.model("Queue", queueSchema);
