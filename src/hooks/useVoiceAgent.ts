import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioPlayer } from '../lib/AudioPlayer';
import { ChatMessage } from '../types';
import useStore from '../lib/store';
import { BOUDICCA_SYSTEM_INSTRUCTION, DEFAULT_MODEL } from '../lib/constants';
import { Chat, GoogleGenAI, Content } from '@google/genai';
import { availableTools } from '../lib/tools';
import { getExpressionForText } from '../lib/expressionEngine';

// Use relative URL that works in both development and production
const TTS_WEBSOCKET_URL = (() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/ws/tts`;
})();

interface UseVoiceAgentProps {
    apiKey: string | null;
    onFinalResult: (result: { summary: string }) => void;
    onError: (error: string) => void;
    systemInstruction?: string;
}

const formatHistoryForChat = (history: ChatMessage[]): Content[] => {
    return history
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.text))
        .map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.text }],
        }));
};

// A map of keywords to trigger gestures from user's input
const userGestureMap: { [key: string]: string } = {
    'wave': 'greeting',
    'dance': 'dance',
    'spin': 'spin',
    'twirl': 'spin',
    'squat': 'squat',
    'crouch': 'squat',
    'peace': 'peacesign',
    'pose': 'pose',
    'fight': 'fight',
    'shoot': 'shoot',
    'fire': 'shoot',
    'what a trick': 'dance_meme',
    'show me a trick': 'dance_meme',
    'do a trick': 'dance_meme',
};

export function useVoiceAgent(props: UseVoiceAgentProps) {
    const { apiKey, onFinalResult, onError, systemInstruction } = props;
    const preferredVoiceName = useStore.use.preferredVoiceName();
    const preferredLanguage = useStore.use.preferredLanguage();
    const [streamingSummary, setStreamingSummary] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const chatHistory = useStore.use.chatHistory();
    const setActiveAnimation = useStore.use.setActiveAnimation();
    const setIsAudioPlaying = useStore.use.setIsAudioPlaying();
    const setActiveExpression = useStore.use.setActiveExpression();
    const setIsTextStreaming = useStore.use.setIsTextStreaming();
    const setGesture = useStore.use.setGesture();
    const addMessage = useStore.use.addMessage();

    const audioPlayerRef = useRef<AudioPlayer | null>(null);
    const chatRef = useRef<Chat | null>(null);
    const aiRef = useRef<GoogleGenAI | null>(null);
    const websocketRef = useRef<WebSocket | null>(null);
    const gestureDebounceRef = useRef<number | null>(null);
    const reconnectAttempts = useRef(0);
    const maxReconnectAttempts = 5;
    const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);

    const detectGesture = useCallback((text: string): string | null => {
        const t = text.toLowerCase();
        if (/\b(wave|greet|hello|hi|hey)\b/.test(t)) return 'greeting';
        if (/\b(shoot|fire)\b/.test(t)) return 'shoot';
        if (/\b(squat|crouch)\b/.test(t)) return 'squat';
        if (/\b(spin|twirl)\b/.test(t)) return 'spin';
        if (/\b(peace)\b/.test(t)) return 'peacesign';
        if (/\b(pose)\b/.test(t)) return 'pose';
        if (/\b(cute|adorable)\b/.test(t)) return 'cute';
        if (/\b(elegant|graceful)\b/.test(t)) return 'elegant';
        if (/\b(fight|attack)\b/.test(t)) return 'fight';
        if (/\b(powerful|strong)\b/.test(t)) return 'powerful';
        if (/\b(ready|pumped)\b/.test(t)) return 'pumped';
        if (t.includes('picatrix') && t.includes('dance')) return 'dance_meme';
        if (/\b(dance)\b/.test(t)) return 'dance';
        if (/\b(wow|amazing|wonderful|excellent|fantastic)\b/.test(t)) return 'powerful';
        if (/\b(talk)\b/.test(t)) return 'talk';
        return null;
    }, []);

    const speakSentence = useCallback((sentence: string) => {
        const trimmedSentence = sentence.trim();
        if (!trimmedSentence) return;

        const ws = websocketRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            onError('TTS WebSocket is not connected. Please try again.');
            // Attempt to reconnect if not already trying
            if (reconnectAttempts.current < maxReconnectAttempts) {
                console.log('[useVoiceAgent] Attempting to reconnect WebSocket...');
                connectWebSocket();
            }
            return;
        }

        console.log(`[useVoiceAgent] Sending sentence to WebSocket: "${trimmedSentence}"`);
        try {
            ws.send(JSON.stringify({
                text: trimmedSentence,
                voice: preferredVoiceName,
                speed: 1.0, // Default speed, can be made configurable
                language: preferredLanguage,
            }));
        } catch (error) {
            console.error('[useVoiceAgent] Error sending message to WebSocket:', error);
            onError('Failed to send message to TTS service');
        }
    }, [onError, preferredVoiceName, preferredLanguage]);

    const connectWebSocket = useCallback(() => {
        // Clean up any existing connection
        if (websocketRef.current) {
            websocketRef.current.close();
        }

        if (reconnectAttempts.current >= maxReconnectAttempts) {
            console.warn('[useVoiceAgent] Max reconnection attempts reached');
            return;
        }

        console.log(`[useVoiceAgent] Connecting to WebSocket: ${TTS_WEBSOCKET_URL}`);
        const ws = new WebSocket(TTS_WEBSOCKET_URL);
        websocketRef.current = ws;

        ws.onopen = () => {
            console.log('[useVoiceAgent] TTS WebSocket connected.');
            reconnectAttempts.current = 0; // Reset reconnection attempts on successful connection
            if (reconnectTimeout.current) {
                clearTimeout(reconnectTimeout.current);
                reconnectTimeout.current = null;
            }
        };

        ws.onclose = () => {
            console.log('[useVoiceAgent] TTS WebSocket disconnected.');
            
            // Attempt to reconnect with exponential backoff
            if (reconnectAttempts.current < maxReconnectAttempts) {
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
                console.log(`[useVoiceAgent] Attempting to reconnect in ${delay}ms...`);
                
                reconnectTimeout.current = setTimeout(() => {
                    reconnectAttempts.current++;
                    connectWebSocket();
                }, delay);
            } else {
                onError('Failed to connect to TTS service after multiple attempts');
            }
        };

        ws.onerror = (event) => {
            console.error('[useVoiceAgent] TTS WebSocket error:', event);
            onError('TTS WebSocket connection error');
        };

        ws.onmessage = async (event) => {
            try {
                if (typeof event.data === 'string') {
                    const message = JSON.parse(event.data);
                    console.log('[useVoiceAgent] Received message:', message);
                    
                    switch (message.type) {
                        case 'audio_chunk':
                            if (message.data) {
                                // Convert hex string to ArrayBuffer
                                const hexString = message.data;
                                const bytes = new Uint8Array(hexString.length / 2);
                                for (let i = 0; i < hexString.length; i += 2) {
                                    bytes[i / 2] = parseInt(hexString.substring(i, i + 2), 16);
                                }
                                audioPlayerRef.current?.enqueue(bytes.buffer);
                            }
                            break;
                        case 'status':
                            console.log(`[useVoiceAgent] Status: ${message.message}`);
                            break;
                        case 'error':
                            console.error(`[useVoiceAgent] Error: ${message.message}`);
                            onError(`TTS Error: ${message.message}`);
                            break;
                        case 'complete':
                            console.log('[useVoiceAgent] TTS generation complete');
                            break;
                    }
                }
            } catch (e) {
                console.error('[useVoiceAgent] Error processing WebSocket message:', e);
            }
        };
    }, [onError]);


    // Effect to initialize clients and WebSocket connection
    useEffect(() => {
        // Initialize AI Client
        if (apiKey && !aiRef.current) {
            aiRef.current = new GoogleGenAI({ apiKey });
        }

        if (!audioPlayerRef.current) {
            audioPlayerRef.current = new AudioPlayer((isPlaying) => {
                setIsAudioPlaying(isPlaying);
                if (!isPlaying) {
                    setActiveAnimation('IDLE');
                    setActiveExpression('neutral');
                }
            });
            audioPlayerRef.current.start();
        }

        // Initialize WebSocket
        connectWebSocket();

        // Cleanup function
        return () => {
            if (websocketRef.current) {
                websocketRef.current.close();
                websocketRef.current = null;
            }
            if (audioPlayerRef.current) {
                audioPlayerRef.current.stop();
            }
            if (gestureDebounceRef.current) {
                clearTimeout(gestureDebounceRef.current);
            }
            if (reconnectTimeout.current) {
                clearTimeout(reconnectTimeout.current);
                reconnectTimeout.current = null;
            }
        };
    }, [apiKey, onError, setActiveAnimation, setActiveExpression, setIsAudioPlaying]);

    const sendText = useCallback(async (text: string) => {
        // Handle direct user gesture commands
        const textLower = text.toLowerCase().trim();
        const gesture = userGestureMap[textLower];
        if (gesture) {
            addMessage(text, 'user');
            setGesture(gesture);
            speakSentence("Sure, watch this!");
            return;
        }

        // Ensure Gemini Chat is initialized
        if (!aiRef.current) {
            onError('AI client not initialized. Please check your API key.');
            return;
        }

        // FIX: Re-create the chat session with the current history from the store.
        // This is necessary because the Chat object's history is private and not
        // publicly mutable, so we can't sync it if the global history changes
        // (e.g., chat cleared). The last message in the history is the user's
        // current prompt, which is passed to sendMessageStream, so we exclude it
        // from the history to avoid duplication.
        chatRef.current = aiRef.current.chats.create({
            model: DEFAULT_MODEL,
            config: {
                systemInstruction: systemInstruction || BOUDICCA_SYSTEM_INSTRUCTION,
                tools: [{ functionDeclarations: availableTools }],
            },
            history: formatHistoryForChat(chatHistory.slice(0, -1)),
        });

        setStreamingSummary('');
        let fullTextResponse = '';
        let sentenceBuffer = '';
        const sentenceEndRegex = /([.!?])(?:\s|'|"|$)/;

        try {
            setIsProcessing(true);
            setIsTextStreaming(true);
            setActiveAnimation('TALKING');

            const result = await chatRef.current.sendMessageStream({ message: text });

            for await (const chunk of result) {
                const chunkText = chunk.text;
                if (chunkText) {
                    fullTextResponse += chunkText;
                    sentenceBuffer += chunkText;
                    setStreamingSummary(fullTextResponse);

                    if (gestureDebounceRef.current) clearTimeout(gestureDebounceRef.current);
                    gestureDebounceRef.current = window.setTimeout(() => {
                        const gestureFromAI = detectGesture(fullTextResponse);
                        if (gestureFromAI) {
                            setGesture(gestureFromAI);
                        }
                        const expression = getExpressionForText(fullTextResponse);
                        setActiveExpression(expression);
                    }, 300); // Debounce to avoid triggering on partial words
                    
                    let match;
                    while ((match = sentenceBuffer.match(sentenceEndRegex)) !== null) {
                        const sentenceEndIndex = (match.index || 0) + match[0].length;
                        const sentence = sentenceBuffer.substring(0, sentenceEndIndex);
                        speakSentence(sentence);
                        sentenceBuffer = sentenceBuffer.substring(sentenceEndIndex);
                    }
                }
            }

            if (sentenceBuffer.trim()) {
                speakSentence(sentenceBuffer);
            }

            onFinalResult({ summary: fullTextResponse });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during chat.';
            console.error('Error sending text to chat session:', error);
            onError(errorMessage);
        } finally {
            setIsProcessing(false);
            setIsTextStreaming(false);
            // Animation and expression state is now handled by the AudioPlayer's onPlaybackStateChange callback
        }
    }, [systemInstruction, chatHistory, onFinalResult, onError, preferredVoiceName, preferredLanguage, setActiveAnimation, setIsTextStreaming, detectGesture, setGesture, addMessage, speakSentence, setActiveExpression]);

    return {
        streamingSummary,
        isProcessing,
        sendText,
    };
}
