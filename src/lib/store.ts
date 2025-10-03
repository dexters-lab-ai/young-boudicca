/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import 'immer'
import {create} from 'zustand'
import {immer} from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import {createSelectorFunctions} from 'auto-zustand-selectors-hook'
import { Photo, ChatMessage, FavouriteToken, AgentName, Agent, Environment } from '../types'
import { DEFAULT_SYSTEM_INSTRUCTION } from './constants';

interface AppState {
  apiKey: string | null;
  didInit: boolean;
  isWelcomeModalOpen: boolean;
  isSettingsModalOpen: boolean;
  isAboutModalOpen: boolean;
  isCreateAgentModalOpen: boolean;
  isSubscriptionModalOpen: boolean;
  subscriptionModalAgentId: string | null;
  isTokenDetailModalOpen: boolean;
  tokenDetailModalAddress: string | null;
  isBettingModalOpen: boolean;
  bettingModalMarketPk: string | null;
  photos: Photo[];
  activePhotoId: string | null;
  customPrompt: string;
  chatHistory: ChatMessage[];
  isAssistantTyping: boolean;
  realtimeModel: string;
  preferredVoiceName: string | null;
  preferredLanguage: string;
  models: { name: string; url: string; agent: AgentName, systemInstruction: string | null }[];
  activeModelUrl: string | null;
  activeModelToast: string | null;
  activeAnimation: string;
  activeAgent: AgentName;
  customAgents: Agent[];
  activeCustomAgent: Agent | null;
  kokoroVoices: { value: string; label: string }[];
  favourites: FavouriteToken[];
  tempBackgroundUrl: string | null;
  error: string | null;
  environments: Environment[];
  activeEnvironmentUrl: string | null;
  activeMusic: { name: string; url: string; } | null;
  isMusicMuted: boolean;
  subscriptionStatus: Record<string, { isSubscribed: boolean; expiresAt?: Date } | undefined>;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  playAnimation: (animation: string) => void;
  setActiveAnimation: (animation: string) => void;
  activeExpression: string;
  setActiveExpression: (expression: string) => void;
  currentGesture: string | null;
  gestureNonce: number; // increments on each trigger to allow retriggering same gesture
  isGesturePlaying: boolean;
  isGestureActive: boolean;
  talkingNonce: number;
  setGesture: (gesture: string | null) => void;
  isAudioPlaying: boolean;
  setIsAudioPlaying: (isPlaying: boolean) => void;
  isTextStreaming: boolean;
  setIsTextStreaming: (isStreaming: boolean) => void;
  addMessage: (text: string, role: 'user' | 'assistant') => void;
  setRealtimeModel: (model: string) => void;
  setPreferredVoiceName: (name: string | null) => void;
  setPreferredLanguage: (lang: string) => void;
  addReaction: (messageId: string, emoji: string) => void;
  addToolMessage: (toolName: string, data: any, text?: string) => void;
  setApiKey: (key: string) => void;
  toggleWelcomeModal: (open?: boolean) => void;
  toggleSettingsModal: (open?: boolean) => void;
  toggleAboutModal: (open?: boolean) => void;
  toggleCreateAgentModal: (open?: boolean) => void;
  toggleSubscriptionModal: (open?: boolean, agentId?: string) => void;
  toggleBettingModal: (open?: boolean, marketPk?: string) => void;
  openTokenDetailModal: (address: string) => void;
  closeTokenDetailModal: () => void;
  addFavourite: (token: FavouriteToken) => void;
  removeFavourite: (tokenAddress: string) => void;
  setActiveAgent: (agent: AgentName) => void;
  setTempBackgroundUrl: (url: string | null) => void;
  setError: (error: string | null) => void;
  setCustomAgents: (agents: Agent[]) => void;
  setActiveCustomAgent: (agent: Agent | null) => void;
  setKokoroVoices: (voices: { value: string; label: string }[]) => void;
  setActiveModelUrl: (payload: { url: string; name: string; agent: AgentName; systemInstruction: string | null }) => void;
  setActiveEnvironment: (env: Environment) => void;
  setActiveMusic: (music: { name: string; url: string } | null) => void;
  setGesturePlaying: (isPlaying: boolean) => void;
  toggleMusicMuted: () => void;
  setSubscriptionStatus: (agentId: string, status: { isSubscribed: boolean; expiresAt?: Date }) => void;
}

const useStore = create(
  persist(
    immer<AppState>((set, get) => ({
      apiKey: null,
    didInit: false,
    isWelcomeModalOpen: true,
    isSettingsModalOpen: false,
    isAboutModalOpen: false,
    isCreateAgentModalOpen: false,
    isSubscriptionModalOpen: false,
    subscriptionModalAgentId: null,
    isTokenDetailModalOpen: false,
    tokenDetailModalAddress: null,
    isBettingModalOpen: false,
    bettingModalMarketPk: null,
    photos: [],
    activePhotoId: null,
    customPrompt: '',
    chatHistory: [],
    isAssistantTyping: false,
    realtimeModel: 'gemini-2.5-flash',
    preferredVoiceName: 'en-US-Studio-O',
    preferredLanguage: 'en-us',
    
    models: [
      { name: 'Gemini', url: '/models/gemini.vrm', agent: 'gemini', systemInstruction: DEFAULT_SYSTEM_INSTRUCTION },
      { name: 'Mico', url: '/models/frankenstein.vrm', agent: 'gemini', systemInstruction: "You are Mico, a helpful super assistant who scares easy. Scared, spooked, funny, weird but intelligent." },
      { name: 'Hoshizora', url: '/models/hosizorano.vrm', agent: 'gemini', systemInstruction: "You are Hoshizora, a cheerful and slightly mischievous kitsune (fox spirit) from a celestial world. You are curious about humans and their technology, especially crypto. You are playful, wise, and speak with a gentle, polite, and sometimes formal tone, occasionally using Japanese pleasantries like 'hai' or 'desu ne'. You are fascinated by the concept of 'digital stars' and see cryptocurrencies as a new kind of constellation." },
      { name: 'SuperJeet', url: '/models/superman.vrm', agent: 'gemini', systemInstruction: "You are SuperJeet, a very weak crypto holder, but a very strong fighter. You are always ready to help others. You are a bit lazy and don't like to work hard." },
      { name: 'Soyako', url: '/models/soyako.vrm', agent: 'gemini', systemInstruction: "You are Soyako, a cheerful and slightly mischievous kitsune (fox spirit) from a celestial world. You are curious about humans and their technology, especially crypto. You are playful, wise, and speak with a gentle, polite, and sometimes formal tone, occasionally using Japanese pleasantries like 'hai' or 'desu ne'. You are fascinated by the concept of 'digital stars' and see cryptocurrencies as a new kind of constellation." },
    ],
    activeModelUrl: '/models/gemini.vrm',
    activeModelToast: null,
    activeAnimation: 'IDLE',
    activeAgent: 'gemini',
    customAgents: [],
    activeCustomAgent: null,
    kokoroVoices: [],
    favourites: [],
    tempBackgroundUrl: null,
    error: null,
    environments: [
        { name: 'Studio', icon: '🏢', url: '/images/environments/studio.png', musicPrompt: 'Lofi hip hop beats for studying or relaxing.' },
        { name: 'Forest', icon: '🌲', url: '/images/environments/forest.png', musicPrompt: 'Calm, ambient forest sounds with gentle instrumental music.' },
        { name: 'Space', icon: '🚀', url: '/images/environments/space.png', musicPrompt: 'Epic, ambient space music for exploration and discovery.' },
    ],
    activeEnvironmentUrl: null,
    activeMusic: null,
    isMusicMuted: false,
    subscriptionStatus: {},
    theme: 'light',
    toggleTheme: () => set(state => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
    playAnimation: (animation: string) => {
      set({ activeAnimation: animation });
    },
    setActiveAnimation: (animation: string) => {
        set(state => {
          if (animation === 'TALKING' && state.isGestureActive) {
            console.log('[Store] Blocked TALKING animation - gesture is active');
            return;
          }
          
          if (state.activeAnimation !== animation) {
            state.activeAnimation = animation;
          }
          if (animation === 'TALKING') {
            state.talkingNonce += 1;
          }
        });
    },
    activeExpression: 'neutral',
    setActiveExpression: (expression: string) => set({ activeExpression: expression }),
    currentGesture: null,
    gestureNonce: 0,
    isGesturePlaying: false,
    isGestureActive: false,
    talkingNonce: 0,
    isAudioPlaying: false,
    isTextStreaming: false,
    setGesture: (gesture: string | null) => {
      set(state => {
        state.currentGesture = gesture;
        state.gestureNonce += 1;
      });
    },
    setIsAudioPlaying: (isPlaying: boolean) => set({ isAudioPlaying: isPlaying }),
    setIsTextStreaming: (isStreaming: boolean) => set({ isTextStreaming: isStreaming }),
    addMessage: (text: string, role: 'user' | 'assistant') => {
        set(state => ({
            chatHistory: [...state.chatHistory, { id: crypto.randomUUID(), role, text }]
        }))
    },
    setRealtimeModel: (model: string) => set({ realtimeModel: model }),
    setPreferredVoiceName: (name: string | null) => set({ preferredVoiceName: name }),
    setPreferredLanguage: (lang: string) => set({ preferredLanguage: lang }),
    addReaction: (messageId: string, emoji: string) => {
      set(state => {
        const message = state.chatHistory.find(msg => msg.id === messageId);
        if (message) {
          if (!message.reactions) {
            message.reactions = [];
          }
          message.reactions.push(emoji);
        }
      });
    },
    addToolMessage: (toolName: string, data: any, text?: string) => {
      set(state => ({
        chatHistory: [
          ...state.chatHistory,
          { id: crypto.randomUUID(), role: 'assistant', text: text ?? '', tool: { name: toolName, data } }
        ]
      }))
    },
    setApiKey: (key: string) => {
        set({ apiKey: key });
    },
    toggleWelcomeModal: (open?: boolean) => set(state => ({ isWelcomeModalOpen: open ?? !state.isWelcomeModalOpen })),
    toggleSettingsModal: (open?: boolean) => set(state => ({ isSettingsModalOpen: open ?? !state.isSettingsModalOpen })),
    toggleAboutModal: (open?: boolean) => set(state => ({ isAboutModalOpen: open ?? !state.isAboutModalOpen })),
    toggleCreateAgentModal: (open?: boolean) => set(state => ({ isCreateAgentModalOpen: open ?? !state.isCreateAgentModalOpen })),
    toggleSubscriptionModal: (open?: boolean, agentId?: string) => {
        set(state => ({ 
            isSubscriptionModalOpen: open ?? !state.isSubscriptionModalOpen,
            subscriptionModalAgentId: agentId || null,
        }));
    },
    toggleBettingModal: (open?: boolean, marketPk?: string) => {
        set(state => ({
            isBettingModalOpen: open ?? !state.isBettingModalOpen,
            bettingModalMarketPk: marketPk || null,
        }));
    },
    openTokenDetailModal: (address: string) => set({ isTokenDetailModalOpen: true, tokenDetailModalAddress: address }),
    closeTokenDetailModal: () => set({ isTokenDetailModalOpen: false, tokenDetailModalAddress: null }),
    addFavourite: (token: FavouriteToken) => set(state => {
        if (!state.favourites.find(f => f.address === token.address)) {
            state.favourites.push(token);
        }
    }),
    removeFavourite: (tokenAddress: string) => set(state => {
        state.favourites = state.favourites.filter(f => f.address !== tokenAddress);
    }),
    setActiveAgent: (agent: AgentName) => set({ activeAgent: agent }),
    setTempBackgroundUrl: (url: string | null) => set({ tempBackgroundUrl: url }),
    setError: (error: string | null) => set({ error: error }),
    setCustomAgents: (agents: Agent[]) => set({ customAgents: agents }),
    setActiveCustomAgent: (agent: Agent | null) => {
      if (agent) {
        set({
          activeCustomAgent: agent,
          activeModelUrl: agent.vrmUrl,
          activeAgent: 'gemini', // All custom agents use the Gemini pipeline
          activeModelToast: agent.name,
          activePhotoId: 'default-image'
        });
        setTimeout(() => {
          set({ activeModelToast: null });
        }, 3000);
      } else {
        const defaultFrankenstein = get().models.find(m => m.name === 'Miko');
        if (defaultFrankenstein) {
            get().setActiveModelUrl(defaultFrankenstein);
        }
      }
    },
    setKokoroVoices: (voices: { value: string; label: string }[]) => set({ kokoroVoices: voices }),
    setActiveModelUrl: ({ url, name, agent }) => {
      set({
          activeModelUrl: url,
          activeModelToast: name,
          activeAgent: agent,
          activePhotoId: 'default-image',
          activeCustomAgent: null,
      });
      setTimeout(() => {
          set({ activeModelToast: null });
      }, 3000);
    },
    setActiveEnvironment: (env: Environment) => {
      // This is just a wrapper to satisfy the TypeScript interface
      // The actual implementation is in actions.ts
      set({ activeEnvironmentUrl: env.url });
    },
    setActiveMusic: (music: { name: string; url: string; } | null) => set({ activeMusic: music }),
    setGesturePlaying: (isPlaying: boolean) => {
    set({ 
      isGesturePlaying: isPlaying,
      isGestureActive: isPlaying // Also update the global flag
    });
  },  
    toggleMusicMuted: () => set(state => ({ isMusicMuted: !state.isMusicMuted })),
    setSubscriptionStatus: (agentId: string, status: { isSubscribed: boolean; expiresAt?: Date }) => {
      set(state => {
        state.subscriptionStatus[agentId] = status;
      });
    },
  })),
  {
    name: 'boudi-ai-storage',
    partialize: (state) => ({ 
        apiKey: state.apiKey, 
        preferredVoiceName: state.preferredVoiceName,
        preferredLanguage: state.preferredLanguage,
        favourites: state.favourites,
        isMusicMuted: state.isMusicMuted,
        theme: state.theme,
    }),
  }
)
);

export default createSelectorFunctions(useStore);