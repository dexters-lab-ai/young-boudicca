import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAgent extends Document {
  name: string;
  description: string;
  systemInstruction: string;
  vrmUrl: string;
  vrmAssetId?: Types.ObjectId;
  creatorWalletAddress: string;
  animationGreetingUrl?: string;
  animationDanceUrl?: string;
  animationSpinUrl?: string;
  animationPoseUrl?: string;
  animationPumpedUrl?: string;
  environmentUrl?: string;
  isPublic: boolean;
  subscriptionPrice: number;
  subscriptionCount: number;
  nftDetails?: {
    mintAddress: string;
    metadataUri?: string;
    tokenStandard: string;
  };
}

const AgentSchema: Schema = new Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  systemInstruction: { type: String, required: true },
  vrmUrl: { type: String, required: true },
  vrmAssetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
  creatorWalletAddress: { type: String, required: true, index: true },
  animationGreetingUrl: { type: String, required: false },
  animationDanceUrl: { type: String, required: false },
  animationSpinUrl: { type: String, required: false },
  animationPoseUrl: { type: String, required: false },
  animationPumpedUrl: { type: String, required: false },
  environmentUrl: { type: String, required: false },
  isPublic: { type: Boolean, default: false },
  subscriptionPrice: { type: Number, default: 1 },
  subscriptionCount: { type: Number, default: 0 },
  nftDetails: {
    mintAddress: { type: String, unique: true, sparse: true, index: true },
    metadataUri: { type: String },
    tokenStandard: { type: String },
  }
}, { timestamps: true });

export default mongoose.model<IAgent>('Agent', AgentSchema);