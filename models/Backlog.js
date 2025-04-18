const mongoose = require('mongoose');
const { Schema } = mongoose;

const backlogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  note: { type: String },
  createdAt: { type: Date, default: Date.now },
  convertedToGoal: { type: Boolean, default: false },
  date: { type: Date }
});

module.exports = mongoose.model("Backlog", backlogSchema);
