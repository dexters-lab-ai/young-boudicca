import { useEffect, useRef } from 'react';
import useStore from '../lib/store';
import imageData from '../lib/imageData';
import { extractSoraMedia, fetchSoraTaskStatus, SoraStatus } from '../lib/soraUtils';

const POLL_INTERVAL_MS = 6000;

export default function useSoraPolling() {
  const photos = useStore.use.photos();
  const setError = useStore.use.setError();
  const addMessage = useStore.use.addMessage();
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const pendingIds = photos
      .filter(photo => photo.mediaType === 'video' && photo.taskId && (photo.isBusy || imageData.tasks[photo.id]?.status === 'waiting'))
      .map(photo => photo.id);

    if (pendingIds.length === 0) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const runPoll = async () => {
      const { photos: latestPhotos } = useStore.getState();
      const candidates = latestPhotos.filter(photo => photo.mediaType === 'video' && photo.taskId && (photo.isBusy || imageData.tasks[photo.id]?.status === 'waiting'));

      await Promise.all(candidates.map(async (photo) => {
        const { id, taskId } = photo;
        if (!taskId) return;
        try {
          const task = await fetchSoraTaskStatus(taskId);
          const status: SoraStatus = task.state;
          const { videoUrl, thumbnailUrl } = extractSoraMedia(task);

          imageData.tasks[id] = { status, error: task.failMsg };
          if (status === 'success' && videoUrl) {
            imageData.videos[id] = { url: videoUrl, thumbnail: thumbnailUrl };
          }

          useStore.setState(state => ({
            photos: state.photos.map(existing => existing.id === id ? { ...existing, isBusy: status === 'waiting' } : existing),
          }));

          if (status === 'success' && videoUrl) {
            addMessage('Sora finished rendering your video. Play it when you are ready.', 'assistant');
          }
        } catch (err: any) {
          const message = String(err?.message || 'Sora status check failed.');
          imageData.tasks[id] = { status: 'fail', error: message };
          useStore.setState(state => ({
            photos: state.photos.map(existing => existing.id === id ? { ...existing, isBusy: false } : existing),
          }));
          setError(message);
        }
      }));
    };

    runPoll();
    pollTimerRef.current = window.setInterval(runPoll, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [photos, addMessage, setError]);
}
