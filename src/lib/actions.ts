/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import useStore, { createAssistantMessage } from './store'
import imageData from './imageData'
import modes from './modes'
import { Photo, Agent, Environment, PaywallDetails, UserCredits, AutonomyLog } from '../types'
import { FALLBACK_WELCOME_MESSAGE, getWelcomeMessageForModelName, buildCustomAgentWelcomeMessage } from './constants'
import { pollSoraTask, SoraStatus, PollStatusPayload } from './soraUtils'
import { fetchApiWith402 } from './fetchApiWith402'
import bs58 from 'bs58';

const get = useStore.getState
const set = useStore.setState
const defaultImageId = 'default-image'
 
export const init = () => {
  if (get().didInit) return

  imageData.inputs[defaultImageId] = defaultImageId
  const initialPhoto: Photo = { id: defaultImageId, isBusy: false, mode: 'default', isInitial: true, mediaType: 'image' }
  
  set(state => {
    const defaultModel = state.models[0] ?? null;
    const welcomeMessage = defaultModel
      ? getWelcomeMessageForModelName(defaultModel.name)
      : FALLBACK_WELCOME_MESSAGE;

    const chatAlreadySeeded = state.chatHistory.some(m => m.text === welcomeMessage);

    return {
      didInit: true,
      photos: [initialPhoto],
      activePhotoId: defaultImageId,
      activeModelUrl: defaultModel?.url ?? null,
      activeEnvironmentUrl: state.environments[0]?.url ?? null,
      chatHistory: chatAlreadySeeded && state.chatHistory.length > 0
        ? state.chatHistory
        : [createAssistantMessage(welcomeMessage)],
    };
  })
}

export const addMessage = (text: string, role: 'user' | 'assistant', sources?: {uri: string, title: string}[]) => {
    set(state => ({
        chatHistory: [...state.chatHistory, { id: crypto.randomUUID(), role, text, sources }]
    }))
}

type GenerateOptions = {
    aspectRatio?: 'portrait' | 'landscape' | 'auto';
    removeWatermark?: boolean;
    suppressUserMessage?: boolean;
};

export const generateImage = async (prompt: string, mode: string) => {
    const { setError, activePhotoId: currentActivePhotoId, photos } = get();
    
    const activePhoto = photos.find(p => p.id === currentActivePhotoId);
    const sourceIsVideo = activePhoto?.mediaType === 'video';
    const sourceImage: string | undefined = (!sourceIsVideo && currentActivePhotoId && currentActivePhotoId !== defaultImageId)
        ? imageData.inputs[currentActivePhotoId]
        : undefined;

    if (!sourceImage) {
        setError('Upload an image first, then pick a filter.');
        addMessage("Choose an image to filter before applying a style.", 'assistant');
        return;
    }

    set({ isAssistantTyping: true, activeAnimation: 'TALKING' });
    addMessage(prompt, 'user');
    
    const newId = crypto.randomUUID();
    imageData.inputs[newId] = sourceImage;

    const newPhoto: Photo = { id: newId, mode, isBusy: true, isInitial: false, mediaType: 'image' };
    set(state => ({
        photos: [...state.photos, newPhoto]
    }));

    try {
        const response = await fetchApiWith402(() => fetch('/api/images/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, inputFile: sourceImage })
        }));

        const { imageUrl: result } = await response.json();

        if (result) {
            imageData.outputs[newId] = result;
            set(state => ({
                photos: state.photos.map(p => p.id === newId ? { ...p, isBusy: false } : p),
                activePhotoId: newId
            }));
            addMessage("There. Done. What's next?", 'assistant');
        } else {
            throw new Error("The server didn't return an image.");
        }
    } catch (err: any) {
        setError(`Image generation failed: ${err.message}`);
        set(state => ({ photos: state.photos.filter(p => p.id !== newId) }));
    } finally {
        set({ isAssistantTyping: false, activeAnimation: 'IDLE' });
    }
};

export const generateSoraVideo = async (prompt: string, options?: GenerateOptions) => {
    const { setError, activePhotoId: currentActivePhotoId, photos, addMessage } = get();
    
    const activePhoto = photos.find(p => p.id === currentActivePhotoId);
    const sourceIsVideo = activePhoto?.mediaType === 'video';
    const sourceImage: string | undefined = (!sourceIsVideo && currentActivePhotoId && currentActivePhotoId !== defaultImageId)
        ? imageData.inputs[currentActivePhotoId]
        : undefined;

    if (!sourceImage) {
        setError('Upload an image first, then try generating a Sora video.');
        return;
    }

    set({ isAssistantTyping: true, activeAnimation: 'TALKING' });
    addMessage(`Generating a Sora video with prompt: "${prompt}"`, 'user');
    
    const aspectRatioOption = options?.aspectRatio === 'landscape' || options?.aspectRatio === 'portrait'
        ? options.aspectRatio
        : undefined;
    const removeWatermark = options?.removeWatermark ?? true;

    const newId = crypto.randomUUID();
    const videoPhoto: Photo = { id: newId, mode: 'sora', isBusy: true, isInitial: false, mediaType: 'video' };
    imageData.inputs[newId] = sourceImage;
    set(state => ({
        photos: [...state.photos, videoPhoto],
        activePhotoId: newId,
    }));

    try {
        const { taskId } = await pollSoraTask({
            prompt,
            imageUrl: sourceImage,
            aspectRatio: aspectRatioOption,
            removeWatermark,
            onStatus: (status: SoraStatus, data?: PollStatusPayload) => {
                imageData.tasks[newId] = { status, error: data?.error };
                if (status === 'success' && data?.videoUrl) {
                    imageData.videos[newId] = { url: data.videoUrl, thumbnail: data.thumbnailUrl };
                    addMessage('Sora finished rendering your video. Play it when you are ready.', 'assistant');
                }
                set(state => ({
                    photos: state.photos.map(p => p.id === newId ? { ...p, isBusy: status === 'waiting' } : p)
                }));
            },
        });
        set(state => ({
            photos: state.photos.map(p => p.id === newId ? { ...p, taskId } : p),
        }));
        addMessage('Video generation started via Sora. I will update you when it finishes.', 'assistant');
    } catch (err: any) {
        console.error('Sora generation failed', err);
        imageData.videos[newId] = undefined;
        imageData.tasks[newId] = { status: 'fail', error: err?.message };
        set(state => ({
            photos: state.photos.filter(p => p.id !== newId),
        }));
        const errorMessage = String(err?.message || 'Failed to start Sora video generation.');
        if (errorMessage.includes('Hourly generation limit')) {
            setError('Sora hourly limit reached. Try again in about an hour.');
        } else {
            setError(errorMessage);
        }
        addMessage('The Sora video request failed. Try again in a bit.', 'assistant');
    } finally {
        set({ isAssistantTyping: false, activeAnimation: 'IDLE' });
    }
};

export const setCustomPrompt = (prompt: string) => {
    set({ customPrompt: prompt })
}

export const handleFilterClick = (key: string) => {
    const mode = modes[key]
    generateImage(mode.prompt, key)
}


export const setActivePhoto = (id: string | null) => {
    set({ activePhotoId: id })
}

export const setInputSource = async (source: 'default' | 'upload' | 'webcam', data?: string) => {
    let newId: string;
    let newPhoto: Photo;

    if (source === 'default') {
        setActivePhoto(defaultImageId)
        // FIX: The 'addMessage' function requires a role.
        addMessage('Back to the default avatar. Good choice.', 'assistant');
        return;
    }

    if (source === 'upload' && data) {
        newId = crypto.randomUUID();
        imageData.inputs[newId] = data;
        newPhoto = { id: newId, isBusy: false, mode: 'upload', isInitial: true, mediaType: 'image' };
        set(state => ({
            photos: [...state.photos, newPhoto],
            activePhotoId: newId
        }));
        // FIX: The 'addMessage' function requires a role.
        addMessage("Image uploaded. What're we doing with it then?", 'assistant');
    }
    
    if (source === 'webcam' && data) {
        newId = crypto.randomUUID();
        imageData.inputs[newId] = data;
        newPhoto = { id: newId, isBusy: false, mode: 'webcam', isInitial: true, mediaType: 'image' };
        set(state => ({
            photos: [...state.photos, newPhoto],
            activePhotoId: newId
        }));
        // FIX: The 'addMessage' function requires a role.
        addMessage("Decent photo. Now, let's make it better.", 'assistant');
    }
}

export const setActiveModelUrl = ({ url, name, systemInstruction }: { url: string, name: string, systemInstruction?: string | null }) => {
  const defaultEnv = get().environments[0];
  get().setActiveModelUrl({ url, name, systemInstruction });
  if (defaultEnv) {
    setActiveEnvironment(defaultEnv);
  }
}

export const toggleAboutModal = (open?: boolean) => {
    set(state => ({ isAboutModalOpen: open ?? !state.isAboutModalOpen }));
}

export const toggleCreateAgentModal = (open?: boolean) => {
    set(state => ({ isCreateAgentModalOpen: open ?? !state.isCreateAgentModalOpen }));
}

export const toggleSettingsModal = (open?: boolean) => {
    set(state => ({ isSettingsModalOpen: open ?? !state.isSettingsModalOpen }));
};

export const fetchUserCredits = async (walletAddress: string) => {
    set({ isLoadingUserCredits: true, userCredits: null });
    try {
        const response = await fetch(`/api/user/me?walletAddress=${walletAddress}`);
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to fetch user credits.');
        }
        const credits: UserCredits = await response.json();
        set({ userCredits: credits, isLoadingUserCredits: false });
    } catch (error: any) {
        get().setError(error.message);
        set({ isLoadingUserCredits: false });
    }
};

export const toggleAutonomy = async (enabled: boolean, wallet: { publicKey: any, signMessage: any }) => {
    const { publicKey, signMessage } = wallet;
    if (!publicKey || !signMessage) {
        get().setError('Wallet not connected or does not support message signing.');
        return;
    }

    try {
        const message = `Set autonomous behavior to ${enabled ? 'ON' : 'OFF'} at ${new Date().toISOString()}`;
        const encodedMessage = new TextEncoder().encode(message);
        const signature = await signMessage(encodedMessage);
        const signatureBase58 = bs58.encode(signature);

        const response = await fetch('/api/user/autonomy', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                walletAddress: publicKey.toBase58(),
                enabled,
                signature: signatureBase58,
                message,
            }),
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to update setting.');
        }

        const { autonomyEnabled } = await response.json();
        // FIX: Changed from immer-style mutation to returning a new state object to satisfy TypeScript.
        set((state) => ({
            userCredits: state.userCredits
              ? { ...state.userCredits, autonomyEnabled: autonomyEnabled }
              : state.userCredits,
        }));
    } catch (error: any) {
        get().setError(error.message);
        // Revert UI on failure
        // FIX: Changed from immer-style mutation to returning a new state object to satisfy TypeScript.
        set((state) => ({
            userCredits: state.userCredits
              ? { ...state.userCredits, autonomyEnabled: !enabled }
              : state.userCredits,
        }));
    }
};

export const fetchAutonomyLogs = async (walletAddress: string) => {
    try {
        const response = await fetch(`/api/user/autonomy-logs?walletAddress=${walletAddress}`);
        if (!response.ok) {
            // Don't throw error on 404 or empty, just fail silently
            return;
        }
        const logs: AutonomyLog[] = await response.json();
        if (logs && logs.length > 0) {
            const logSummary = logs.map(log => `- ${log.text}`).join('\n');
            const message = `**While you were away...**\n\nI did a few things:\n${logSummary}`;
            addMessage(message, 'assistant');
        }
    } catch (error) {
        console.error('Failed to fetch autonomy logs:', error);
    }
};


export const toggleSubscriptionModal = (open?: boolean, agentId?: string) => {
    set(state => ({ 
        isSubscriptionModalOpen: open ?? !state.isSubscriptionModalOpen,
        subscriptionModalAgentId: agentId || null,
    }));
};

export const togglePaywallModal = (open?: boolean, details?: PaywallDetails) => {
    set(state => ({
        isPaywallModalOpen: open ?? !state.isPaywallModalOpen,
        paywallDetails: details || null,
    }));
};

export const openTokenDetailModal = (address: string) => {
    set({ isTokenDetailModalOpen: true, tokenDetailModalAddress: address });
};

export const closeTokenDetailModal = () => {
    set({ isTokenDetailModalOpen: false, tokenDetailModalAddress: null });
};

export const setActiveCustomAgent = (agent: Agent | null) => {
  if (agent) {
    const toastLabel = agent.name;
    set({
      activeCustomAgent: agent,
      activeModelUrl: agent.vrmUrl,
      activeModelToast: toastLabel,
      activePhotoId: 'default-image',
      customPrompt: '',
      chatHistory: [createAssistantMessage(buildCustomAgentWelcomeMessage(agent))],
    });
    setTimeout(() => {
      if (get().activeModelToast === toastLabel) {
        set({ activeModelToast: null });
      }
    }, 3000);
  } else {
    const currentModel = get().models.find(m => m.url === get().activeModelUrl) ?? null;
    const welcome = currentModel
      ? getWelcomeMessageForModelName(currentModel.name)
      : FALLBACK_WELCOME_MESSAGE;
    set({
      activeCustomAgent: null,
      customPrompt: '',
      chatHistory: [createAssistantMessage(welcome)],
    });
  }
}

export const playBackgroundMusic = async (env: Environment) => {
    if (!env.musicPrompt) {
        get().setActiveMusic(null);
        return;
    }
    try {
        const response = await fetch('/api/music/compose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: env.musicPrompt }),
        });
        if (!response.ok) {
            throw new Error(`Failed to compose music: ${response.statusText}`);
        }
        const audioBlob = await response.blob();
        const musicUrl = URL.createObjectURL(audioBlob);
        get().setActiveMusic({ name: env.name, url: musicUrl });

    } catch (error) {
        console.error("Failed to play background music:", error);
        get().setActiveMusic(null);
    }
}

export const setActiveEnvironment = (env: Environment) => {
    playBackgroundMusic(env);
    set({ activeEnvironmentUrl: env.url });
};

export const setGesturePlaying = (isPlaying: boolean) => {
    set({ isGesturePlaying: isPlaying });
};

export const toggleMusicMuted = () => {
    set(state => ({ isMusicMuted: !state.isMusicMuted }));
};

init()