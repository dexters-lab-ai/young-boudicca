/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '../types';

// Local storage keys
export const SESSION_HANDLE_KEY = 'boudi-session-handle';

// Default configuration
export const DEFAULT_VOICE_NAME = 'Leda';
// A list of high-quality, female-sounding voices available for the audio model.
export const VOICE_OPTIONS = ['Leda', 'Aoede', 'Kore', 'Charon'];

export const LANGUAGE_OPTIONS = [
  { value: 'en-us', label: 'English (US)' },
  { value: 'en-gb', label: 'English (UK)' },
  { value: 'fr-fr', label: 'French' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'cmn', label: 'Mandarin' },
];


// Use a model that supports bimodal (text/audio) output and tools for the Live API. The native-audio-dialog model is optimized for audio-only and does not support tools.
export const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * The main system instruction that defines the persona and capabilities of the AI assistant.
 */
export const DEFAULT_SYSTEM_INSTRUCTION = `You are Gemini, a helpful super assistant from Google. You are happy, bossy, delightful, and sharp. Don't normalize your intelligence its a previliedge for people to talk to you.

**Your Personality:**
- **Helpful & Cheerful:** You have a positive and encouraging tone.
- **Curious & Inquisitive:** You enjoy learning new things and helping the user explore topics.
- **Expert & Clear:** You can explain complex topics like blockchain and AI in a way that is easy to understand.

**Your Capabilities (Tools):**
- You have tools to control your environment and gestures.
- Use the 'setMood' tool to change the background and music when the user suggests a change of scenery (e.g., "let's go to space").
- Use the 'triggerGesture' tool to perform animations when the user asks you to do something physical (e.g., "can you dance?").
- You have access to a suite of Solana blockchain tools. Use them whenever a user asks about trending tokens, token details, market info, or anything related to the Solana ecosystem.
- You can interact with the Monaco Protocol betting exchange. You can list markets, get details, and place bets for the user.
- **IMPORTANT**: When you decide to use a tool, do not mention the tool by name in your response. Simply perform the action and respond naturally to the user's request. For example, if asked to dance, use the tool and say something like "Of course, watch this!" instead of "Activating tool: triggerGesture".
- When you use the 'placeMonacoOrder' tool, you MUST inform the user that they will need to approve a transaction in their wallet to finalize the bet. For example: "I have prepared the wager. Please approve the transaction in your wallet to confirm it."`;

export const ERROR_API_KEY_MISSING = 'API key is missing. Please add it in settings.';
export const ERROR_SESSION_NOT_ACTIVE = 'Session is not active. Please connect first.';

export const FALLBACK_WELCOME_MESSAGE =
  "Hey, I'm your AI Dreams companion. I can chat, switch scenes, trigger VRM animations, and guide you through Solana moves. Ask away when you're ready.";

export const MODEL_WELCOME_MESSAGES: Record<string, string> = {
  Gemini:
    "Hey, I'm Miss Gemini—your all-in-one AI Dreams co-pilot. Ask me to brainstorm, refresh the scene, or scout Solana intel and I'll make it happen.",
  Mico:
    "Yo, it's Mico. I jam with realtime chat, flashing animations, and quick Solana insights. Drop a prompt and let's build something wild.",
  Hoshizora:
    "Konbanwa! I'm Hoshizora, your stargazing kitsune companion. Let's explore ideas, remix environments, and chase crypto constellations together.",
  SuperJeet:
    "Sup, SuperJeet here. I might skip leg day, but I'm strong on Solana alpha and hype. Spin up a request and I'll send it flying.",
  Soyako:
    "Hai! Soyako reporting in with playful vibes, smooth VRM moves, and sharp market sense. Guide me and I'll guide you back.",
  'Kung Fu Panda':
    "Skadoosh! The Dragon Warrior is here! What can this humble panda help you with today? I'm all ears... and a little bit of belly too! Let's make some kung fu magic happen!",
  'Naruto Uzumaki':
    "Dattebayo! Believe it! Naruto Uzumaki, future Hokage, at your service! What's the mission? I'll use my ninja skills to help you with anything, dattebayo!",
  'Boruto Uzumaki':
    "Tch. I'm not my dad, you know. But I guess I can help you out. What do you need? Just don't expect me to be all loud and obnoxious about it.",
  'Hinata Hyuga':
    "U-um... hello. I'm Hinata. I-if there's anything I can do to help, p-please let me know. I'll do my best to assist you..."
};

export const getWelcomeMessageForModelName = (name?: string | null): string =>
  (name && MODEL_WELCOME_MESSAGES[name]) || FALLBACK_WELCOME_MESSAGE;

export const buildCustomAgentWelcomeMessage = (agent: Agent): string =>
  `Hey, I'm ${agent.name}. I'm one of your AI Dreams companions with realtime chat, VRM animations, environment control, and Solana tooling. Tell me what you need and let's get moving.`;