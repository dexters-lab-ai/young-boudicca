import mongoose, { Schema, Document } from 'mongoose';

export interface IAgent extends Document {
  name: string;
  description: string;
  systemInstruction: string;
  vrmUrl: string;
  creatorWalletAddress: string;
  animationGreetingUrl?: string;
  animationDanceUrl?: string;
  animationSpinUrl?: string;
  animationPoseUrl?: string;
  animationPumpedUrl?: string;
  environmentUrl?: string;
}

const AgentSchema: Schema = new Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  systemInstruction: { type: String, required: true },
  vrmUrl: { type: String, required: true },
  creatorWalletAddress: { type: String, required: true, index: true },
  animationGreetingUrl: { type: String, required: false },
  animationDanceUrl: { type: String, required: false },
  animationSpinUrl: { type: String, required: false },
  animationPoseUrl: { type: String, required: false },
  animationPumpedUrl: { type: String, required: false },
  environmentUrl: { type: String, required: false },
}, { timestamps: true });

export default mongoose.model<IAgent>('Agent', AgentSchema);