import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscribedAgent {
  agent: mongoose.Types.ObjectId;
  expiresAt: Date;
}

export interface IUser extends Document {
  walletAddress: string;
  creatorPayoutWallet?: string;
  subscribedAgents: ISubscribedAgent[];
  unlockedAgents: mongoose.Types.ObjectId[];
  freePromptUsage: number;
  paidPromptCredits: number;
  soraCredits: number;
  imageCredits: number;
}

const SubscribedAgentSchema: Schema = new Schema({
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
    expiresAt: { type: Date, required: true },
});

const UserSchema: Schema = new Schema({
  walletAddress: { type: String, required: true, unique: true, index: true },
  creatorPayoutWallet: { type: String, unique: true, sparse: true },
  subscribedAgents: [SubscribedAgentSchema],
  unlockedAgents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }],
  freePromptUsage: { type: Number, default: 0 },
  paidPromptCredits: { type: Number, default: 0 },
  soraCredits: { type: Number, default: 0 },
  imageCredits: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model<IUser>('User', UserSchema);