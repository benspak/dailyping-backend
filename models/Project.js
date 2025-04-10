const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  description: { type: String },
  goalIds: [{ type: Schema.Types.ObjectId, ref: "Response" }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Project", projectSchema);
