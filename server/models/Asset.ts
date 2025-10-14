import mongoose, { Document, Schema } from 'mongoose';

export type AssetType = 'model' | 'animation' | 'background';

export interface IAsset extends Document {
  ownerWallet: string;
  type: AssetType;
  fileName: string;
  contentType: string;
  size: number;
  bucketFileId: string;
  downloadUrl: string;
  originalName: string;
}

const AssetSchema: Schema<IAsset> = new Schema(
  {
    ownerWallet: { type: String, required: true, index: true },
    type: { type: String, enum: ['model', 'animation', 'background'], required: true },
    fileName: { type: String, required: true },
    originalName: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    bucketFileId: { type: String, required: true, unique: true },
    downloadUrl: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IAsset>('Asset', AssetSchema);
