import { useState, useCallback, useRef } from 'react';
import useStore from '../lib/store';
import { errorService } from '../lib/ErrorService';
import { fetchApiWith402 } from '../lib/fetchApiWith402';

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
    systemInstruction?: string;
}

/**
 * A comprehensive voice agent hook that manages the entire conversation flow:
 * 1. Speech-to-Text (STT) via the browser's SpeechRecognition API.
 * 2. Language Model (LLM) interaction with a server-side Gemini engine for text responses.
 * 3. Text-to-Speech (TTS) via a secure backend endpoint for ElevenLabs, with high-precision scheduling.
 */
export function useVoiceAgent(props: UseVoiceAgentProps) {
    const { systemInstruction } = props;

    // --- Global State ---
    const { addMessage, chatHistory, preferredVoiceName: preferredVoiceId, setIsTextStreaming, activeCustomAgent, walletAddress } = useStore.getState();

    // --- Local State and Refs ---
    const [streamingSummary, setStreamingSummary] = useState('');
    const [isProcessing] = useState(false); // True when Gemini is thinking or TTS is happening
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<ISpeechRecognition | null>(null);
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
    
    // Send text to our server-side Gemini endpoint
    const sendText = useCallback(async (text: string) => {
        if (!walletAddress) {
            errorService.dispatchError("Please connect your wallet to chat.");
            return;
        }
        addMessage(text, 'user');
        setIsTextStreaming(true);

        try {
            const response = await fetchApiWith402('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    history: chatHistory,
                    agentId: activeCustomAgent?._id,
                    walletAddress: walletAddress,
                })
            });

            if (!response.body) {
                throw new Error("The response body is empty.");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let currentMessage = '';
            let fullResponseText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonString = line.substring(6);
                        if (jsonString.trim() === '[DONE]') continue;
                        
                        try {
                            const { text: chunkText } = JSON.parse(jsonString);

                            if (chunkText) {
                                currentMessage += chunkText;
                                fullResponseText += chunkText;
                                setStreamingSummary(fullResponseText);
        
                                // Sentence-based TTS queuing
                                const sentences = currentMessage.split(/(?<=[.?!])\s+/);
                                if (sentences.length > 1) {
                                    const completeSentences = sentences.slice(0, -1);
                                    audioQueue.current.push(...completeSentences);
                                    if (!isPlayingAudio.current) {
                                        playNextAudio();
                                    }
                                    currentMessage = sentences[sentences.length - 1];
                                }
                            }
                        } catch (e) {
                            console.error("Failed to parse stream chunk:", jsonString, e);
                        }
                    }
                }
            }

            // Queue any remaining part of the message
            if (currentMessage.trim()) {
                audioQueue.current.push(currentMessage.trim());
                if (!isPlayingAudio.current) {
                    playNextAudio();
                }
            }
            
            // Add the final, full message to the chat history
            if (fullResponseText) {
                addMessage(fullResponseText, 'assistant');
            }

        } catch (err: any) {
            console.error("Error sending message to backend:", err);
            const friendlyError = err.message.includes('402') ? 'Payment required to continue.' : (err.message || 'Failed to get response from the server.');
            errorService.dispatchError(friendlyError);
            addMessage(`Sorry, I ran into an issue: ${friendlyError}`, 'assistant');
        } finally {
            setStreamingSummary('');
            setIsTextStreaming(false);
        }
    }, [addMessage, playNextAudio, setIsTextStreaming, chatHistory, activeCustomAgent, walletAddress, systemInstruction]);


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