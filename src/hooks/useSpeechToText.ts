import { useState, useEffect, useRef, useCallback } from 'react';
import useStore from '../lib/store';

// FIX: Add interfaces for SpeechRecognition to fix typing issues.
// These interfaces are minimal definitions for the Web Speech API.
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

// Browser compatibility check
// FIX: Cast window to `any` to access non-standard SpeechRecognition properties.
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const isSpeechRecognitionSupported = !!SpeechRecognition;

interface UseSpeechToTextOptions {
  onTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onError: (error: string) => void;
}

export function useSpeechToText(options: UseSpeechToTextOptions) {
  const { onTranscript, onFinalTranscript, onError } = options;
  const [isListening, setIsListening] = useState(false);
  // FIX: Use the custom ISpeechRecognition interface for the ref type.
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const listeningStateRef = useRef(false); // Ref to hold the real listening state to avoid stale closures in onend

  useEffect(() => {
    listeningStateRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    if (!isSpeechRecognitionSupported) {
      onError('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition: ISpeechRecognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      onTranscript(interimTranscript);
      if (finalTranscript) {
        onFinalTranscript(finalTranscript);
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      onError(event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      // The onend event can fire automatically. If we are still supposed
      // to be listening (based on the ref), restart it.
      if (listeningStateRef.current) {
        try {
            recognition.start();
        } catch(e) {
            // This can happen if the browser window is not focused
            console.warn("Could not restart speech recognition automatically.");
            setIsListening(false);
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
        listeningStateRef.current = false; // Ensure it doesn't restart on unmount
        recognition.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTranscript, onFinalTranscript, onError]);

  const startListening = useCallback(() => {
    if (listeningStateRef.current || !recognitionRef.current) return;
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      console.error("Could not start speech recognition:", e);
      onError("Could not start listening. Please check microphone permissions.");
    }
  }, [onError]);

  const stopListening = useCallback(() => {
    if (!listeningStateRef.current || !recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  }, []);
  
  const toggleListening = useCallback(() => {
      if(listeningStateRef.current) {
          stopListening();
      } else {
          startListening();
      }
  }, [startListening, stopListening]);

  return { isListening, toggleListening, isSpeechRecognitionSupported };
}