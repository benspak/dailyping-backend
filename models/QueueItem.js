const mongoose = require('mongoose');
const { Schema } = mongoose;

const queueItemSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  note: { type: String },
  createdAt: { type: Date, default: Date.now },
  convertedToGoal: { type: Boolean, default: false },
  dueDate: { type: Date }
});

module.exports = mongoose.model("Queue", queueItemSchema);
