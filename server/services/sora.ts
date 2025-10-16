const API_BASE = 'https://api.kie.ai/api/v1';

export interface CreateImageToVideoParams {
  apiKey: string;
  prompt: string;
  imageUrls: string[];
  aspectRatio?: 'portrait' | 'landscape';
  removeWatermark?: boolean;
  callBackUrl?: string;
}

export interface SoraCreateTaskResponse {
  taskId: string;
  raw: any;
}

export interface SoraTaskRecord {
  taskId: string;
  model: string;
  state: 'waiting' | 'success' | 'fail';
  param?: Record<string, unknown> | null;
  resultJson?: { resultUrls?: string[] } | null;
  failCode?: string | null;
  failMsg?: string | null;
  costTime?: number | null;
  completeTime?: number | null;
  createTime?: number | null;
  raw: any;
}

async function requestJson<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json',
  };

  if (init.method && init.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch (err) {
    const message = response.ok
      ? 'Failed to parse response from Sora API.'
      : `Sora API error (${response.status}) with non-JSON body.`;
    throw new Error(message);
  }

  if (!response.ok || payload?.code !== 200) {
    const message = payload?.msg || `Sora API request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function createImageToVideoTask(params: CreateImageToVideoParams): Promise<SoraCreateTaskResponse> {
  const body = {
    model: 'sora-2-image-to-video',
    input: {
      prompt: params.prompt,
      image_urls: params.imageUrls,
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...(typeof params.removeWatermark === 'boolean' ? { remove_watermark: params.removeWatermark } : {}),
    },
    ...(params.callBackUrl ? { callBackUrl: params.callBackUrl } : {}),
  };

  const payload = await requestJson<any>(params.apiKey, '/jobs/createTask', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const taskId = payload?.data?.taskId;
  if (!taskId) {
    throw new Error('Sora API did not return a taskId.');
  }

  return { taskId, raw: payload };
}

export async function getImageToVideoTask(params: { apiKey: string; taskId: string }): Promise<SoraTaskRecord> {
  const payload = await requestJson<any>(params.apiKey, `/jobs/recordInfo?taskId=${encodeURIComponent(params.taskId)}`, {
    method: 'GET',
  });

  const data = payload?.data ?? {};

  let parsedParam: Record<string, unknown> | null = null;
  if (typeof data.param === 'string') {
    try {
      parsedParam = JSON.parse(data.param);
    } catch {
      parsedParam = null;
    }
  }

  let parsedResult: { resultUrls?: string[] } | null = null;
  if (typeof data.resultJson === 'string') {
    try {
      parsedResult = JSON.parse(data.resultJson);
    } catch {
      parsedResult = null;
    }
  }

  return {
    taskId: data.taskId,
    model: data.model,
    state: data.state,
    param: parsedParam,
    resultJson: parsedResult,
    failCode: data.failCode,
    failMsg: data.failMsg,
    costTime: data.costTime,
    completeTime: data.completeTime,
    createTime: data.createTime,
    raw: payload,
  };
}
