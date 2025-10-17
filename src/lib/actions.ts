/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import useStore, { createAssistantMessage } from './store'
import imageData from './imageData'
import { generateImage as genImageApi } from './llm'
import modes from './modes'
import { Photo, Agent, Environment, AgentName } from '../types'
import { FALLBACK_WELCOME_MESSAGE, getWelcomeMessageForModelName } from './constants'
import { pollSoraTask, SoraStatus, PollStatusPayload } from './soraUtils'

const get = useStore.getState
const set = useStore.setState
const imageModel = 'gemini-2.5-flash-image-preview'
const defaultImageId = 'default-image'
 

export const init = () => {
  if (get().didInit) return

  // If an API key is already stored, don't show the welcome modal.
  if (get().apiKey) {
    set({ isWelcomeModalOpen: false });
  }

  imageData.inputs[defaultImageId] = defaultImageId
  const initialPhoto: Photo = { id: defaultImageId, isBusy: false, mode: 'default', isInitial: true, mediaType: 'image' }
  
  set(state => {
    const defaultModel = state.models.find(m => m.agent === 'gemini') ?? state.models[0] ?? null;
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

export const generateImage = async (prompt: string, mode: string, options?: GenerateOptions) => {
    const setError = get().setError;
    // Require a user-provided image (upload/webcam). Do not auto-use the default avatar.
    const activePhotoId = get().activePhotoId
    const activePhoto = get().photos.find(p => p.id === activePhotoId);
    const sourceIsVideo = activePhoto?.mediaType === 'video';
    let sourceImage: string | undefined = (!sourceIsVideo && activePhotoId && activePhotoId !== defaultImageId)
        ? imageData.inputs[activePhotoId]
        : undefined;

    if (!sourceImage && mode !== 'sora') {
        // Show a temporary placeholder image (favicon) for 5 seconds while waiting for user upload
        const tempId = crypto.randomUUID();
        const placeholder = '/images/frankenstein-icon.png';
        imageData.inputs[tempId] = placeholder;
        const tempPhoto: Photo = { id: tempId, mode: 'placeholder', isBusy: false, isInitial: true, mediaType: 'image' };
        set(state => ({ photos: [...state.photos, tempPhoto], activePhotoId: tempId }));
        addMessage("Choose an image to filter — showing a placeholder for a moment.", 'assistant');
        setTimeout(() => {
            // Remove placeholder if still active
            const current = get().activePhotoId;
            if (current === tempId) {
                set(state => ({
                    photos: state.photos.filter(p => p.id !== tempId),
                    activePhotoId: defaultImageId,
                }));
            } else {
                // Otherwise just drop the temp card
                set(state => ({ photos: state.photos.filter(p => p.id !== tempId) }));
            }
        }, 5000);
        return;
    }

    set({ isAssistantTyping: true, activeAnimation: 'TALKING' })

    if (!options?.suppressUserMessage) {
        addMessage(prompt, 'user')
    }
    
    if (mode === 'sora') {
        const aspectRatioOption = options?.aspectRatio === 'landscape' || options?.aspectRatio === 'portrait'
            ? options.aspectRatio
            : undefined;
        const removeWatermark = options?.removeWatermark ?? true;
        if (!sourceImage) {
            setError('Upload an image first, then try generating a Sora video.');
            set({ isAssistantTyping: false, activeAnimation: 'IDLE' });
            return;
        }

        const newId = crypto.randomUUID();
        const videoPhoto: Photo = { id: newId, mode, isBusy: true, isInitial: false, mediaType: 'video' };
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
        return;
    }

    if (!sourceImage) {
        set({ isAssistantTyping: false, activeAnimation: 'IDLE' });
        setError('Upload an image first, then pick a filter.');
        return;
    }

    const newId = crypto.randomUUID()
    imageData.inputs[newId] = sourceImage;

    const newPhoto: Photo = { id: newId, mode, isBusy: true, isInitial: false, mediaType: 'image' }
    set(state => ({
        photos: [...state.photos, newPhoto]
    }))

    let result: string | null = null;
    try {
        result = await genImageApi({
            model: imageModel,
            prompt,
            inputFile: sourceImage,
        })
    } catch (err: any) {
        set({ isAssistantTyping: false, activeAnimation: 'IDLE' })
        if (String(err?.message || '') === 'QUOTA') {
            setError("You've hit the Gemini API quota limit. Please check your billing or try again later.");
        } else {
            setError("That failed. Try a different prompt or check your API key in settings.");
        }
        // Remove the temp photo card we just added
        set(state => ({ photos: state.photos.filter(p => p.id !== newId) }))
        return;
    }

    set({ isAssistantTyping: false, activeAnimation: 'IDLE' })

    if (result) {
        imageData.outputs[newId] = result
        set(state => ({
            photos: state.photos.map(p => p.id === newId ? {...p, isBusy: false} : p),
            activePhotoId: newId
        }))
        addMessage("There. Done. What's next?", 'assistant')
    } else {
        addMessage("Dinnae work. Try something else.", 'assistant')
        set(state => ({
            photos: state.photos.filter(p => p.id !== newId)
        }))
    }
}

export const generateSoraVideo = async (prompt: string, options?: GenerateOptions) => {
    await generateImage(prompt, 'sora', { ...options, suppressUserMessage: true });
}

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
        addMessage("Decent photo. Now, let's make it better.", 'assistant');
    }
}

export const setApiKey = (apiKey: string) => {
    set({ apiKey });
};

export const setActiveModelUrl = ({ url, name, agent, systemInstruction }: { url: string, name: string, agent: AgentName, systemInstruction?: string | null }) => {
  const defaultEnv = get().environments[0];
  get().setActiveModelUrl({ url, name, agent, systemInstruction });
  if (defaultEnv) {
    setActiveEnvironment(defaultEnv);
  }
}

export const setActiveAgent = (agent: AgentName) => {
    const newModel = get().models.find(m => m.agent === agent);
    if (newModel) {
        setActiveModelUrl(newModel);
    }
};

export const toggleSettingsModal = (open?: boolean) => {
    set(state => ({ isSettingsModalOpen: open ?? !state.isSettingsModalOpen }));
}

export const toggleWelcomeModal = (open?: boolean) => {
    set(state => ({ isWelcomeModalOpen: open ?? !state.isWelcomeModalOpen }));
}

export const toggleAboutModal = (open?: boolean) => {
    set(state => ({ isAboutModalOpen: open ?? !state.isAboutModalOpen }));
}

export const toggleCreateAgentModal = (open?: boolean) => {
    set(state => ({ isCreateAgentModalOpen: open ?? !state.isCreateAgentModalOpen }));
}

export const toggleSubscriptionModal = (open?: boolean, agentId?: string) => {
    set(state => ({ 
        isSubscriptionModalOpen: open ?? !state.isSubscriptionModalOpen,
        subscriptionModalAgentId: agentId || null,
    }));
};

export const toggleBettingModal = (open?: boolean, marketId?: string) => {
    get().toggleBettingModal(open, marketId);
}

export const openTokenDetailModal = (address: string) => {
    set({ isTokenDetailModalOpen: true, tokenDetailModalAddress: address });
};

export const closeTokenDetailModal = () => {
    set({ isTokenDetailModalOpen: false, tokenDetailModalAddress: null });
};

export const setActiveCustomAgent = (agent: Agent | null) => {
  if (agent) {
    const defaultEnv = get().environments[0];
    const agentEnv = get().environments.find(e => e.url === agent.environmentUrl) || defaultEnv;
    get().setActiveCustomAgent(agent);
    if (agentEnv) {
      setActiveEnvironment(agentEnv);
    }
  } else {
    get().setActiveCustomAgent(null);
    const fallbackEnv = get().environments[0];
    if (fallbackEnv) {
      setActiveEnvironment(fallbackEnv);
    }
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