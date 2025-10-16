export type SoraStatus = 'waiting' | 'success' | 'fail';

export interface PollStatusPayload {
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface PollSoraTaskOptions {
  prompt: string;
  imageUrl: string;
  aspectRatio?: 'portrait' | 'landscape';
  removeWatermark?: boolean;
  onStatus?: (status: SoraStatus, payload?: PollStatusPayload) => void;
}

export interface SoraResultJson {
  resultUrls?: string[];
  result_urls?: string[];
  thumbnailUrls?: string[];
  thumbnailUrl?: string;
}

export interface SoraTaskRecord {
  taskId: string;
  state: SoraStatus;
  failMsg?: string;
  resultJson?: SoraResultJson;
}

export function extractSoraMedia(record: SoraTaskRecord | null | undefined): { videoUrl?: string; thumbnailUrl?: string } {
  if (!record?.resultJson) return {};
  const { resultJson } = record;
  const rawResult = resultJson.resultUrls ?? resultJson.result_urls;
  const videoUrl = Array.isArray(rawResult) ? rawResult[0] : undefined;
  const rawThumbs = resultJson.thumbnailUrls;
  const thumbnailUrl = Array.isArray(rawThumbs) ? rawThumbs[0] : resultJson.thumbnailUrl;
  return { videoUrl, thumbnailUrl };
}

const DEFAULT_POLL_INTERVAL = 4000;
const MAX_ATTEMPTS = 45; // ~3 minutes

export async function pollSoraTask(options: PollSoraTaskOptions): Promise<{ taskId: string }> {
  const { prompt, imageUrl, aspectRatio, removeWatermark = true, onStatus } = options;

  const createResponse = await fetch('/api/sora/image-to-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      imageUrls: [imageUrl],
      aspectRatio,
      removeWatermark,
    }),
  });

  if (!createResponse.ok) {
    const errorPayload = await safeJson(createResponse);
    throw new Error(errorPayload?.error || 'Failed to start Sora generation.');
  }

  const { taskId } = await createResponse.json();
  if (!taskId) {
    throw new Error('Sora response missing taskId.');
  }

  onStatus?.('waiting');

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await delay(DEFAULT_POLL_INTERVAL);

    const task = await fetchSoraTaskStatus(taskId);
    if (!task) {
      continue;
    }

    const state: SoraStatus = task.state;

    if (state === 'waiting') {
      onStatus?.('waiting');
      continue;
    }

    if (state === 'fail') {
      const error = task.failMsg || 'Sora task failed.';
      onStatus?.('fail', { error });
      throw new Error(error);
    }

    if (state === 'success') {
      const { videoUrl, thumbnailUrl } = extractSoraMedia(task);
      if (!videoUrl) {
        onStatus?.('fail', { error: 'Sora task succeeded but no videoUrl returned.' });
        throw new Error('Sora task succeeded but no video URL was returned.');
      }

      onStatus?.('success', { videoUrl, thumbnailUrl });
      return { taskId };
    }
  }

  throw new Error('Timed out waiting for Sora to finish.');
}

export async function fetchSoraTaskStatus(taskId: string): Promise<SoraTaskRecord> {
  const statusResponse = await fetch(`/api/sora/image-to-video/${taskId}`);
  if (!statusResponse.ok) {
    const statusPayload = await safeJson(statusResponse);
    throw new Error(statusPayload?.error || 'Failed to check Sora task status.');
  }

  const payload = await statusResponse.json();
  const task = payload?.task as SoraTaskRecord | undefined;
  if (!task) {
    throw new Error('Malformed Sora task status response.');
  }
  return task;
}
async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
