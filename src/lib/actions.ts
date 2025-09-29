/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import useStore from './store'
import imageData from './imageData'
import { generateImage as genImageApi } from './llm'
import modes from './modes'
import { Photo, Agent, Environment } from '../types'

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
  const initialPhoto: Photo = { id: defaultImageId, isBusy: false, mode: 'default', isInitial: true }
  
  set(state => {
    const commonState = {
      didInit: true,
      photos: [initialPhoto],
      activePhotoId: defaultImageId,
      activeModelUrl: state.models.find(m => m.agent === 'boudicca')?.url ?? null,
      activeEnvironmentUrl: state.environments[0]?.url ?? null,
    };
    
    const welcomeMessage = "I’m Young Boudicca — a virtual being. I craft images, chat, and pull live info when asked. Upload or snap a photo to style it, or just tell me what you want.";

    // Avoid adding duplicate welcome messages on hot reloads
    if (state.chatHistory.some(m => m.text === welcomeMessage)) {
      return commonState;
    }

    return {
        ...commonState,
        chatHistory: [...state.chatHistory, {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: welcomeMessage,
        }]
    };
  })
}

export const addMessage = (text: string, role: 'user' | 'assistant', sources?: {uri: string, title: string}[]) => {
    set(state => ({
        chatHistory: [...state.chatHistory, { id: crypto.randomUUID(), role, text, sources }]
    }))
}

export const generateImage = async (prompt: string, mode: string) => {
    const setError = get().setError;
    // Require a user-provided image (upload/webcam). Do not auto-use the default avatar.
    const activePhotoId = get().activePhotoId
    let sourceImage: string | undefined = (activePhotoId && activePhotoId !== defaultImageId)
        ? imageData.inputs[activePhotoId]
        : undefined;

    if (!sourceImage) {
        // Show a temporary placeholder image (favicon) for 5 seconds while waiting for user upload
        const tempId = crypto.randomUUID();
        const placeholder = '/images/boudicca.png';
        imageData.inputs[tempId] = placeholder;
        const tempPhoto: Photo = { id: tempId, mode: 'placeholder', isBusy: false, isInitial: true };
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
    
    addMessage(prompt, 'user')
    
    const newId = crypto.randomUUID()
    imageData.inputs[newId] = sourceImage;

    const newPhoto: Photo = { id: newId, mode, isBusy: true, isInitial: false }
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
        newPhoto = { id: newId, isBusy: false, mode: 'upload', isInitial: true };
        set(state => ({
            photos: [...state.photos, newPhoto],
            activePhotoId: newId
        }));
        addMessage("Image uploaded. What're we doing with it then?", 'assistant');
    }
    
    if (source === 'webcam' && data) {
        newId = crypto.randomUUID();
        imageData.inputs[newId] = data;
        newPhoto = { id: newId, isBusy: false, mode: 'webcam', isInitial: true };
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

export const setActiveModelUrl = ({ url, name, agent }: { url: string, name: string, agent: 'boudicca' | 'eliza' }) => {
  const defaultEnv = get().environments[0];
  set({ activeModelUrl: url, activeModelToast: name, activeAgent: agent, activePhotoId: defaultImageId, activeCustomAgent: null });
  setActiveEnvironment(defaultEnv);
  setTimeout(() => {
    set({ activeModelToast: null });
  }, 3000);
}

export const setActiveAgent = (agent: 'boudicca' | 'eliza') => {
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
    set({
      activeCustomAgent: agent,
      activeModelUrl: agent.vrmUrl,
      activeAgent: 'boudicca', // Custom agents are always Boudicca persona
      activeModelToast: agent.name,
      activePhotoId: 'default-image',
    });
    setActiveEnvironment(agentEnv);
     setTimeout(() => {
      set({ activeModelToast: null });
    }, 3000);
  } else {
    // Revert to a default model when deselecting a custom agent
    const defaultModel = get().models.find(m => m.agent === 'boudicca');
    if (defaultModel) {
      setActiveModelUrl(defaultModel);
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