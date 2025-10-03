import { useState, useCallback, useRef } from 'react';
import { ChatMessage } from '../types';
import useStore from '../lib/store';
// FIX: Corrected import from FRANKENSTEIN_SYSTEM_INSTRUCTION to DEFAULT_SYSTEM_INSTRUCTION
import { DEFAULT_SYSTEM_INSTRUCTION, DEFAULT_MODEL } from '../lib/constants';
import { Chat, GoogleGenAI, Content, Part } from '@google/genai';
import { availableTools } from '../lib/tools';
import { dispatchToolCall } from '../lib/toolDispatcher';
import { errorService } from '../lib/ErrorService';

// --- Interfaces for browser SpeechRecognition API ---
interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
}

interface ISpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onresult: (event: any) => void;
    onerror: (event: SpeechRecognitionErrorEvent) => void;
    onend: () => void;
}
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const isSpeechRecognitionSupported = !!SpeechRecognition;
// --- End SpeechRecognition interfaces ---

interface UseVoiceAgentProps {
    apiKey: string | null;
    systemInstruction?: string;
}

const formatHistoryForChat = (history: ChatMessage[]): Content[] => {
    return history
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.text)) // Only include messages with text
        .map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.text! }],
        }));
};

/**
 * A comprehensive voice agent hook that manages the entire conversation flow:
 * 1. Speech-to-Text (STT) via the browser's SpeechRecognition API.
 * 2. Language Model (LLM) interaction with Google Gemini for text responses and tool calls.
 * 3. Text-to-Speech (TTS) via a secure backend endpoint for ElevenLabs, with high-precision scheduling.
 */
export function useVoiceAgent(props: UseVoiceAgentProps) {
    const { apiKey, systemInstruction } = props;

    // --- Global State ---
    const { addMessage, addToolMessage, chatHistory, preferredVoiceName: preferredVoiceId, setIsTextStreaming } = useStore.getState();

    // --- Local State and Refs ---
    const [streamingSummary, setStreamingSummary] = useState('');
    const [isProcessing] = useState(false); // True when Gemini is thinking or TTS is happening
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<ISpeechRecognition | null>(null);
    const chatRef = useRef<Chat | null>(null);
    // FIX: Add ref to store chat config to avoid accessing private properties.
    const chatConfigRef = useRef<{ model: string; systemInstruction: string } | null>(null);
    const audioQueue = useRef<string[]>([]);
    const isPlayingAudio = useRef(false);

    // --- Audio Playback ---
    const playNextAudio = useCallback(async () => {
        if (isPlayingAudio.current || audioQueue.current.length === 0) {
            return;
        }
        isPlayingAudio.current = true;
        
        const textToSpeak = audioQueue.current.shift();
        if (!textToSpeak) {
            isPlayingAudio.current = false;
            return;
        }

        try {
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: textToSpeak, voiceId: preferredVoiceId }),
            });

            if (!response.ok) {
                throw new Error(`TTS service failed with status ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);

            audio.onended = () => {
                isPlayingAudio.current = false;
                URL.revokeObjectURL(audioUrl);
                // Immediately check if there's more audio to play
                playNextAudio();
            };
            audio.onerror = (err) => {
                console.error("Error playing audio:", err);
                isPlayingAudio.current = false;
                playNextAudio();
            };
            
            audio.play();

        } catch (error) {
            console.error("Failed to play TTS audio:", error);
            isPlayingAudio.current = false;
            playNextAudio();
        }
    }, [preferredVoiceId]);
    
     // --- Gemini Chat Interaction ---
    const initializeChat = useCallback(() => {
        if (!apiKey) {
            errorService.dispatchError('API key not set. Please configure it in settings.');
            return false;
        }
        const ai = new GoogleGenAI({ apiKey });
        // FIX: Corrected constant name
        const finalSystemInstruction = systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
        chatRef.current = ai.chats.create({
            model: DEFAULT_MODEL,
            config: {
                systemInstruction: finalSystemInstruction,
                tools: [{ functionDeclarations: availableTools }],
            },
            history: formatHistoryForChat(chatHistory),
        });
        // FIX: Store the config used for initialization.
        chatConfigRef.current = { model: DEFAULT_MODEL, systemInstruction: finalSystemInstruction };
        return true;
    }, [apiKey, systemInstruction, chatHistory]);

    // Send text to Gemini
    const sendText = useCallback(async (text: string) => {
        setIsTextStreaming(true);
        addMessage(text, 'user');

        // FIX: Check against stored config in chatConfigRef instead of private properties of Chat.
        // FIX: Corrected constant name
        const finalSystemInstruction = systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
        if (!chatRef.current || chatConfigRef.current?.model !== DEFAULT_MODEL || chatConfigRef.current?.systemInstruction !== finalSystemInstruction) {
            if (!initializeChat()) {
                setIsTextStreaming(false);
                return;
            }
        }

        // FIX: Do not attempt to set private `history` property. History is seeded on initialization.

        let currentMessage = '';
        let fullResponseText = '';
        
        try {
            const stream = await chatRef.current!.sendMessageStream({ message: text });
            
            for await (const chunk of stream) {
                const chunkText = chunk.text;
                if (chunkText) {
                    currentMessage += chunkText;
                    fullResponseText += chunkText;
                    setStreamingSummary(fullResponseText);

                    // Sentence-based TTS queuing
                    const sentences = currentMessage.split(/(?<=[.?!])\s+/);
                    if (sentences.length > 1) {
                        const completeSentences = sentences.slice(0, -1);
                        audioQueue.current.push(...completeSentences);
                        currentMessage = sentences[sentences.length - 1];
                        if (!isPlayingAudio.current) {
                            playNextAudio();
                        }
                    }
                }
                
                if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                    for (const fc of chunk.functionCalls) {
                        const { name, args } = fc;
                        
                        if (!name) {
                            console.error('Tool name is undefined');
                            continue; // Skip this function call if name is undefined
                        }
                        
                        // Dispatch the tool call and get the full result for the UI
                        const uiResult = await dispatchToolCall(name, args);
                        addToolMessage(name, uiResult);
                        
                        // Create a simplified result to send back to the LLM
                        const llmResult = {
                            success: !uiResult.error,
                            ...(uiResult.bet && { betId: uiResult.bet.id }),
                            ...(uiResult.data && { itemCount: uiResult.data.length }),
                        };
                        
                        // FIX: The `tool_responses` property is invalid. Send a `FunctionResponsePart` instead.
                        // The `sendMessageStream` method expects an object with a `message` property.
                        // The value of `message` should be an array of `Part`s.
                        const functionResponsePart: Part = {
                            functionResponse: {
                                name: fc.name,
                                response: llmResult,
                            }
                        };
                        // To continue the conversation with a tool response, we need a new stream.
                        // The existing stream is for the model's response to the user's text.
                        // We can't send on the same stream we are reading from.
                        // The correct pattern is to end this loop, then send a new message with the function response.
                        // For simplicity in this streaming implementation, we'll assume the model may respond with text *after* the tool call in a subsequent message.
                        // A more robust implementation might manage multiple streams or a different chat loop.
                        // For now, let's send the response back which will trigger a new stream from the model.
                        const toolStream = await chatRef.current!.sendMessageStream({ message: [functionResponsePart] });
                        for await (const toolChunk of toolStream) {
                             const toolChunkText = toolChunk.text;
                            if (toolChunkText) {
                                currentMessage += toolChunkText;
                                fullResponseText += toolChunkText;
                                setStreamingSummary(fullResponseText);

                                const sentences = currentMessage.split(/(?<=[.?!])\s+/);
                                if (sentences.length > 1) {
                                    const completeSentences = sentences.slice(0, -1);
                                    audioQueue.current.push(...completeSentences);
                                    currentMessage = sentences[sentences.length - 1];
                                    if (!isPlayingAudio.current) {
                                        playNextAudio();
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Queue the last sentence
            if (currentMessage.trim()) {
                audioQueue.current.push(currentMessage.trim());
                if (!isPlayingAudio.current) {
                    playNextAudio();
                }
            }
            
            addMessage(fullResponseText, 'assistant');

        } catch (err: any) {
            console.error("Error sending message to Gemini:", err);
            errorService.dispatchError(`Failed to get response from Gemini. ${err.message}`);
        } finally {
            setStreamingSummary('');
            setIsTextStreaming(false);
        }

    }, [addMessage, addToolMessage, initializeChat, playNextAudio, systemInstruction, setIsTextStreaming]);


    // --- Speech Recognition ---
    const startListening = useCallback(() => {
        if (isListening || !isSpeechRecognitionSupported) return;

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        let finalTranscript = '';

        recognition.onresult = (event: any) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            
            // For now, we only care about the final transcript
            if (finalTranscript) {
                sendText(finalTranscript.trim());
                finalTranscript = ''; // Reset for next utterance
            }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error('Speech recognition error:', event.error);
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognition.start();
        setIsListening(true);
        recognitionRef.current = recognition;
    }, [isListening, sendText]);

    const stopListening = useCallback(() => {
        if (!isListening || !recognitionRef.current) return;
        recognitionRef.current.stop();
        setIsListening(false);
    }, [isListening]);

    const toggleListening = useCallback(() => {
        isListening ? stopListening() : startListening();
    }, [isListening, startListening, stopListening]);

    return {
        isListening,
        isProcessing,
        streamingSummary,
        sendText,
        toggleListening,
        isSpeechRecognitionSupported
    };
}