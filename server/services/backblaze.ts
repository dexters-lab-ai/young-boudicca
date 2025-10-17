import Backblaze from 'backblaze-b2';

export interface BackblazeCredentials {
  keyId: string;
  applicationKey: string;
  bucketId: string;
}

export interface BackblazeAuthContext {
  apiUrl: string;
  downloadUrl: string;
  authorizationToken: string;
}

export class BackblazeService {
  private client: Backblaze;
  private bucketId: string;
  private authContext: BackblazeAuthContext | null = null;

  constructor(credentials: BackblazeCredentials) {
    this.client = new Backblaze({
      applicationKeyId: credentials.keyId,
      applicationKey: credentials.applicationKey,
    });
    this.bucketId = credentials.bucketId;
  }

  async authorize(): Promise<void> {
    if (this.authContext) {
      return;
    }
    const response = await this.client.authorize();
    const { apiUrl, downloadUrl, authorizationToken } = response.data;
    this.authContext = {
      apiUrl,
      downloadUrl,
      authorizationToken,
    };
  }

  async ensureAuthorized(): Promise<BackblazeAuthContext> {
    if (!this.authContext) {
      await this.authorize();
    }
    return this.authContext!;
  }

  async uploadFile(params: {
    fileName: string;
    data: Buffer;
    contentType?: string;
    info?: Record<string, string>;
  }): Promise<{ fileId: string; fileName: string; downloadUrl: string }>
  {
    const auth = await this.ensureAuthorized();
    const uploadUrlResponse = await this.client.getUploadUrl({
      bucketId: this.bucketId,
      authorizationToken: auth.authorizationToken,
    });
    const { uploadUrl, authorizationToken: uploadAuthToken } = uploadUrlResponse.data;

    const result = await this.client.uploadFile({
      uploadUrl,
      uploadAuthToken,
      fileName: params.fileName,
      data: params.data,
      contentType: params.contentType,
      info: params.info,
    });

    const { fileId, fileName } = result.data;

    return {
      fileId,
      fileName,
      downloadUrl: `${auth.downloadUrl}/file/${this.bucketId}/${encodeURIComponent(fileName)}`,
    };
  }

  async getDownloadUrl(fileName: string): Promise<string> {
    const auth = await this.ensureAuthorized();
    return `${auth.downloadUrl}/file/${this.bucketId}/${encodeURIComponent(fileName)}`;
  }
}

export function createBackblazeServiceFromEnv(): BackblazeService | null {
  const keyId = process.env.BACKBLAZE_KEY_ID;
  const applicationKey = process.env.BACKBLAZE_APPLICATION_KEY;
  const bucketId = process.env.BACKBLAZE_BUCKET_ID;

  if (!keyId || !applicationKey || !bucketId) {
    return null;
  }

  return new BackblazeService({ keyId, applicationKey, bucketId });
}
