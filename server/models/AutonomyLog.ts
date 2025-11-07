import mongoose, { Schema, Document } from 'mongoose';

export interface IAutonomyLog extends Document {
  walletAddress: string;
  agentId: mongoose.Types.ObjectId;
  actionType: 'MONOLOGUE' | 'TOOL_CALL';
  text: string;
}

const AutonomyLogSchema: Schema = new Schema({
  walletAddress: { type: String, required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  actionType: { type: String, enum: ['MONOLOGUE', 'TOOL_CALL'], required: true },
  text: { type: String, required: true },
}, { timestamps: true });

export default mongoose.model<IAutonomyLog>('AutonomyLog', AutonomyLogSchema);