import mongoose from "mongoose";
const { Schema } = mongoose;

const projectSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true },
  description: { type: String },
  goalIds: [{ type: Schema.Types.ObjectId, ref: "Response" }],
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Project", projectSchema);
