import { useState, useCallback, useRef, useEffect } from 'react';
import { LiveApiSessionManager } from '../lib/LiveApiSessionManager';
import useStore from '../lib/store';
import { BOUDICCA_SYSTEM_INSTRUCTION } from '../lib/constants';

interface UseVoiceAgentProps {
    apiKey: string | null;
    languageCode: string;
    voiceName?: string | null;
    onFinalResult: (result: { summary: string }) => void;
    onError: (error: string) => void;
    systemInstruction?: string;
}

/**
 * A React hook to manage a voice-first AI agent session.
 * It orchestrates the LiveApiSessionManager and connects it to the app's state.
 */
export function useVoiceAgent(props: UseVoiceAgentProps) {
    const { apiKey, languageCode, voiceName, onFinalResult, onError, systemInstruction } = props;
    
    // Global state selectors
    const setAgentState = useStore.use.setAgentState();
    const agentState = useStore.use.agentState();
    const setStreamingSummary = useStore.use.setStreamingSummary();
    const streamingSummary = useStore.use.streamingSummary();
    const addMessage = useStore.use.addMessage();
    const addToolMessage = useStore.use.addToolMessage();
    const chatHistory = useStore.use.chatHistory();

    // Refs for session management
    const sessionManagerRef = useRef<LiveApiSessionManager | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const [isRecording, setIsRecording] = useState(false);

    const stopAudioSession = useCallback(() => {
        sessionManagerRef.current?.close();
        sessionManagerRef.current = null;
    }, []);

    // --- Microphone Recording Management ---
    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        setIsRecording(false);
        // Only go idle if we aren't about to start thinking/speaking
        if (agentState === 'listening') {
            setAgentState('idle');
        }
    }, [agentState, setAgentState]);

    /**
     * Creates and connects a new Live API session if one is not already active.
     * @returns The session manager instance if successful, otherwise null.
     */
    const startSession = useCallback(async (): Promise<LiveApiSessionManager | null> => {
        // If a session manager exists and its underlying connection is active, return it.
        if (sessionManagerRef.current?.isConnected()) {
            return sessionManagerRef.current;
        }
        if (!apiKey) {
            onError('API key is not set.');
            return null;
        }
        stopAudioSession(); // Clean up any old session before creating a new one.

        const manager = new LiveApiSessionManager({
            apiKey,
            languageCode,
            voiceName: voiceName || undefined,
            systemInstruction: systemInstruction || BOUDICCA_SYSTEM_INSTRUCTION,
            chatHistory,
            onStateChange: setAgentState,
            onFinalResult,
            onToolCall: addToolMessage,
            onStreamingText: setStreamingSummary,
            onTranscript: (transcript, isFinal) => {
                if (isFinal && transcript) {
                    addMessage(transcript, 'user');
                    sessionManagerRef.current?.sendTextQuery(transcript);
                    stopRecording();
                }
            },
            onError: (error) => {
                console.error('Voice session error:', error);
                onError(error);
                stopAudioSession();
            },
        });
        sessionManagerRef.current = manager;
        try {
            await manager.connect(); // This now waits for the audio connection to be fully open.
            return manager;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Failed to start session: ${errorMessage}`);
            onError(errorMessage);
            stopAudioSession();
            return null;
        }
    }, [
        apiKey, languageCode, voiceName, systemInstruction, chatHistory,
        setAgentState, onFinalResult, addToolMessage, setStreamingSummary, addMessage, stopRecording, onError, stopAudioSession
    ]);

    const startRecording = useCallback(async () => {
        // Interrupt any ongoing speech synthesis before starting to listen.
        if (sessionManagerRef.current?.isConnected()) {
             sessionManagerRef.current.interrupt();
        }
        
        // Ensure we have a valid session before proceeding.
        // This will create one if it doesn't exist.
        const manager = await startSession();
        if (!manager) {
            onError("Failed to initialize a session for recording.");
            return;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0 && sessionManagerRef.current?.isConnected()) {
                    sessionManagerRef.current.sendAudio(event.data);
                }
            };
            recorder.onstop = stopRecording;

            recorder.start(500); // Send data every 500ms
            setIsRecording(true);
            setAgentState('listening');

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("Failed to start recording:", msg);
            onError("Microphone access denied or failed. Please check permissions.");
            stopRecording();
        }
    }, [startSession, stopRecording, onError, setAgentState]);

    const toggleRecording = useCallback(() => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }, [isRecording, startRecording, stopRecording]);

    const sendText = useCallback(async (text: string) => {
        // A text message should always start a session if one isn't active.
        // `startSession` is idempotent and will return the existing session if it's already connected.
        const manager = await startSession();

        if (manager) {
            manager.sendTextQuery(text);
        } else {
            // startSession would have already called onError, so just log for debugging.
            console.error("Could not send text query because session failed to start.");
        }
    }, [startSession]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopRecording();
            stopAudioSession();
        };
    }, [stopRecording, stopAudioSession]);

    const isSessionActive = agentState !== 'idle' && agentState !== 'disconnected';

    return {
        agentState,
        isSessionActive,
        streamingSummary,
        toggleRecording,
        sendText,
    };
}