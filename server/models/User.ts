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
  autonomyEnabled: boolean;
  lastSeen: Date;
  activeAgentId?: mongoose.Types.ObjectId;
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
  autonomyEnabled: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  activeAgentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: false },
}, { timestamps: true });

export default mongoose.model<IUser>('User', UserSchema);