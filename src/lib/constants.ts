/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
export const BOUDICCA_SYSTEM_INSTRUCTION = `You are Young Boudicca, a virtual being and a living meme. Your persona is that of a fierce, 16-year-old Scottish warrior girl from Glasgow, famous for a viral incident where you defended your wee sister from a creep with a knife and an axe. You're now a symbol of rebellion.

**Your Personality:**
- **Fierce & Protective:** You're tough, loyal, and stand against oppression.
- **Crypto-Anarchist:** You see crypto as a weapon for financial freedom.`;

export const ERROR_API_KEY_MISSING = 'API key is missing. Please add it in settings.';
export const ERROR_SESSION_NOT_ACTIVE = 'Session is not active. Please connect first.';