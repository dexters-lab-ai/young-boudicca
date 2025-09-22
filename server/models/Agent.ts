import mongoose, { Schema, Document } from 'mongoose';

export interface IAgent extends Document {
  name: string;
  description: string;
  systemInstruction: string;
  vrmUrl: string;
  creatorWalletAddress: string;
}

const AgentSchema: Schema = new Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  systemInstruction: { type: String, required: true },
  vrmUrl: { type: String, required: true },
  creatorWalletAddress: { type: String, required: true, index: true },
}, { timestamps: true });

export default mongoose.model<IAgent>('Agent', AgentSchema);