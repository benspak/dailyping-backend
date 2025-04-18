const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String },
  goalIds: [{ type: Schema.Types.ObjectId, ref: "Goal" }],
  users: [{ type: String, required: true }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Project", projectSchema);
