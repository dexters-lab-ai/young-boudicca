import mongoose, { Schema, Document } from 'mongoose';

interface IChatMessage {
  role: 'user' | 'assistant' | 'model';
  text: string;
}

export interface IChatHistory extends Document {
  walletAddress: string;
  history: IChatMessage[];
}

const ChatMessageSchema: Schema = new Schema({
  role: { type: String, required: true },
  text: { type: String, required: true },
}, { _id: false });

const ChatHistorySchema: Schema = new Schema({
  walletAddress: { type: String, required: true, unique: true, index: true },
  history: [ChatMessageSchema],
}, { timestamps: true });

export default mongoose.model<IChatHistory>('ChatHistory', ChatHistorySchema);