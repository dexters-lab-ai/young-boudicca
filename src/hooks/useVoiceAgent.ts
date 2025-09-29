import { useState, useCallback, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import useStore from '../lib/store';
import { BOUDICCA_SYSTEM_INSTRUCTION, DEFAULT_MODEL } from '../lib/constants';
import { Chat, GoogleGenAI, Content, FunctionDeclaration } from '@google/genai';
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
    const { addMessage, addToolMessage, chatHistory, preferredVoiceName: preferredVoiceId, setActiveAnimation, setIsTextStreaming, setGesture, activeModelUrl, activeCustomAgent } = useStore.getState();

    // --- Local State and Refs ---
    const [streamingSummary, setStreamingSummary] = useState('');
    const [isProcessing, setIsProcessing] = useState(false); // True when Gemini is thinking or TTS is happening
    const [isListening, setIsListening] = useState(false);
    
    const chatRef = useRef<Chat | null>(null);
    const aiRef = useRef<GoogleGenAI | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const recognitionRef = useRef<ISpeechRecognition | null>(null);
    const listeningStateRef = useRef(false);

    // High-precision audio scheduling refs
    const nextStartTime = useRef(0);
    const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
    const lastPlayedNodeRef = useRef<AudioBufferSourceNode | null>(null);

    // --- Helper Functions ---
    const ensureAudioContextResumed = useCallback(async () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }
    }, []);

    const speakSentence = useCallback(async (sentence: string) => {
        const trimmed = sentence.trim();
        if (!trimmed) return;
        
        await ensureAudioContextResumed();
        const audioContext = audioContextRef.current;
        if (!audioContext) return;

        try {
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: trimmed, voiceId: preferredVoiceId || '21m00Tcm4TlvDq8ikWAM' }),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'TTS request failed');
            }
            
            const audioData = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(audioData);
            
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            // Schedule playback seamlessly
            const currentTime = audioContext.currentTime;
            const startTime = nextStartTime.current > currentTime ? nextStartTime.current : currentTime;
            source.start(startTime);
            nextStartTime.current = startTime + audioBuffer.duration;

            // Track audio nodes to know when speech is finished
            audioQueueRef.current.push(source);
            lastPlayedNodeRef.current = source;
            source.onended = () => {
                const index = audioQueueRef.current.indexOf(source);
                if (index > -1) audioQueueRef.current.splice(index, 1);
                
                // If this was the last audio clip and we are not streaming more text, go idle.
                if (lastPlayedNodeRef.current === source && !useStore.getState().isTextStreaming) {
                    setActiveAnimation('IDLE');
                }
            };

        } catch (error) {
            console.error("TTS error:", error);
            errorService.dispatchError("Failed to generate speech from ElevenLabs.");
        }
    }, [preferredVoiceId, ensureAudioContextResumed, setActiveAnimation]);


    // --- Core Logic ---
    const sendText = useCallback(async (text: string) => {
        await ensureAudioContextResumed();
        if (!aiRef.current) {
            errorService.dispatchError('AI client not initialized. Check API key.');
            return;
        }
        addMessage(text, 'user');

        if (!chatRef.current) {
            chatRef.current = aiRef.current.chats.create({
                model: DEFAULT_MODEL,
                config: {
                    systemInstruction: systemInstruction || BOUDICCA_SYSTEM_INSTRUCTION,
                    tools: [{ functionDeclarations: availableTools as FunctionDeclaration[] }],
                },
                history: formatHistoryForChat(chatHistory),
            });
        }
        
        setIsProcessing(true);
        setIsTextStreaming(true);
        setStreamingSummary('');
        
        // Reset audio scheduler for the new response
        if (audioContextRef.current) {
            nextStartTime.current = audioContextRef.current.currentTime;
        }
        audioQueueRef.current = [];
        lastPlayedNodeRef.current = null;
        
        let fullTextResponse = '';
        let sentenceBuffer = '';
        const sentenceEndRegex = /[^.!?]+[.!?](?:\"|'|\s|$)/g;
        
        try {
            const result = await chatRef.current.sendMessageStream({ message: text });
            for await (const chunk of result) {
                 // Handle tool calls first
                if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                    
                    const toolCall = chunk.functionCalls[0]; // Process first tool call
                    if (!toolCall.name) {
                        console.error('Tool call missing name:', toolCall);
                        continue;
                    }
                    
                    addMessage(`Thinking... Using tool: \`${toolCall.name}\``, 'assistant');
                    const apiResponse = await dispatchToolCall(toolCall.name, toolCall.args);

                    if (apiResponse.error) {
                       addMessage(`Tool \`${toolCall.name}\` failed: ${apiResponse.error}`, 'assistant');
                    } else if (toolCall.name.startsWith('fetch')) {
                        addToolMessage(toolCall.name, apiResponse);
                    }
                    
                    const toolResult = await chatRef.current.sendMessageStream({
                       message: [{ functionResponse: { name: toolCall.name, response: apiResponse } }]
                    });

                    // Process the model's summary of the tool result
                    for await (const toolChunk of toolResult) {
                         const chunkText = toolChunk.text;
                         if(chunkText) {
                            if (fullTextResponse.length === 0) setActiveAnimation('TALKING');
                            fullTextResponse += chunkText;
                            sentenceBuffer += chunkText;
                            setStreamingSummary(fullTextResponse);
                         }
                    }
                    // Since we've consumed the tool response stream, break the outer loop.
                    break; 
                }

                // Handle regular text responses
                const chunkText = chunk.text;
                if (chunkText) {
                    if (fullTextResponse.length === 0) {
                        // Start talking animation on the very first text chunk.
                        setActiveAnimation('TALKING');
                    }
                    fullTextResponse += chunkText;
                    sentenceBuffer += chunkText;
                    setStreamingSummary(fullTextResponse);
                    
                    let sentences;
                    while ((sentences = sentenceEndRegex.exec(sentenceBuffer)) !== null) {
                        const sentence = sentences[0];
                        await speakSentence(sentence);
                        sentenceBuffer = sentenceBuffer.substring(sentences.index + sentence.length);
                        sentenceEndRegex.lastIndex = 0;
                    }
                }
            }
            
            // Process any remaining text in the buffer
            if (sentenceBuffer.trim()) {
                await speakSentence(sentenceBuffer);
            }

            if (fullTextResponse.trim()) {
              addMessage(fullTextResponse, 'assistant');
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Chat error';
            console.error('Error during chat stream:', error);
            errorService.dispatchError(errorMessage);
        } finally {
            setIsTextStreaming(false);
            setStreamingSummary('');
            // Crucially, wait for the *last* audio clip to finish before setting IDLE
            if (audioQueueRef.current.length === 0) {
                setActiveAnimation('IDLE');
            }
            setIsProcessing(false);
        }
    }, [
        systemInstruction, chatHistory, addMessage, addToolMessage,
        setActiveAnimation, setIsTextStreaming, setGesture, speakSentence, ensureAudioContextResumed
    ]);
    
    // --- Speech Recognition Logic ---
    useEffect(() => {
        listeningStateRef.current = isListening;
    }, [isListening]);

    useEffect(() => {
        if (!isSpeechRecognitionSupported) {
            console.warn('Speech recognition not supported in this browser.');
            return;
        }

        const recognition: ISpeechRecognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                sendText(finalTranscript.trim());
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            errorService.dispatchError(`Microphone error: ${event.error}`);
            setIsListening(false);
        };

        recognition.onend = () => {
            if (listeningStateRef.current) {
                try {
                    recognition.start();
                } catch (e) {
                    console.warn("Could not restart speech recognition automatically.");
                    setIsListening(false);
                }
            }
        };

        recognitionRef.current = recognition;

        return () => {
            listeningStateRef.current = false;
            recognition.stop();
        };
    }, [sendText]);
    
    // --- Effects and Initializers ---

    useEffect(() => {
        chatRef.current = null;
    }, [systemInstruction, activeModelUrl, activeCustomAgent]);

    useEffect(() => {
        if (apiKey && !aiRef.current) {
            aiRef.current = new GoogleGenAI({ apiKey });
        }
    }, [apiKey]);
    
    const toggleListening = useCallback(async () => {
        await ensureAudioContextResumed();
        if (listeningStateRef.current) {
            recognitionRef.current?.stop();
            setIsListening(false);
        } else {
            recognitionRef.current?.start();
            setIsListening(true);
        }
    }, [ensureAudioContextResumed]);

    return {
        streamingSummary,
        isProcessing,
        isListening,
        sendText,
        toggleListening,
        isSpeechRecognitionSupported
    };
}
