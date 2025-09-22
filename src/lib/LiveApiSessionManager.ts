import { GoogleGenAI, LiveServerMessage, Modality, Session, LiveConnectConfig, Part, LiveCallbacks } from '@google/genai';
import { SessionState } from '../types';
import { StreamingAudioPlayer } from './StreamingAudioPlayer';
import { errorService } from './ErrorService';
import { ERROR_API_KEY_MISSING, ERROR_SESSION_NOT_ACTIVE } from './constants';

interface LiveApiManagerProps {
    apiKey: string;
    onStateChange: (state: SessionState) => void;
    onInterrupt: () => void;
    onError: (error: string) => void;
    languageCode: string;
    voiceName?: string;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Manages a client-side session with the Google Generative AI Live API,
 * specialized for low-latency audio input and output. This class is now
 * a pure "voice" channel and does not handle tools or complex reasoning.
 */
export class LiveApiSessionManager {
    private ai: GoogleGenAI;
    private session: Session | null = null;
    private props: LiveApiManagerProps;
    private audioPlayer: StreamingAudioPlayer;
    private _isConnected: boolean = false;
    private speakingDebounce?: number;

    constructor(props: LiveApiManagerProps) {
        if (!props.apiKey) {
            errorService.dispatchError(ERROR_API_KEY_MISSING);
            throw new Error(ERROR_API_KEY_MISSING);
        }
        
        this.props = props;
        // IMPORTANT: The audio-only model requires the v1alpha API version.
        this.ai = new GoogleGenAI({ apiKey: this.props.apiKey, httpOptions: { apiVersion: 'v1alpha' } });
        this.audioPlayer = new StreamingAudioPlayer();
    }

    private handleServerMessage(message: LiveServerMessage) {
        if (message.serverContent) {
            const content = message.serverContent;
            if ('modelTurn' in content && content.modelTurn?.parts) {
                for (const part of content.modelTurn.parts) {
                    const mime = part.inlineData?.mimeType;
                    const data = part.inlineData?.data;
                    if (mime && mime.startsWith('audio/') && typeof data === 'string') {
                        // Enter speaking state on audio chunk
                        this.props.onStateChange('speaking');
                        if (this.speakingDebounce) {
                            clearTimeout(this.speakingDebounce);
                        }
                        const audioData = base64ToArrayBuffer(data);
                        this.audioPlayer.play(audioData);
                        // Revert to connected after brief silence window
                        this.speakingDebounce = window.setTimeout(() => {
                            this.props.onStateChange('connected');
                        }, 300);
                    }
                }
            }
            if ('interrupted' in content) {
                this.props.onInterrupt();
                this.audioPlayer.stop();
            }
        }
    }

    public async connect(): Promise<void> {
        if (this.session) {
            return;
        }
        this.props.onStateChange('connecting');

        const liveCallbacks: LiveCallbacks = {
            onopen: () => {
                console.log('✅ Live API audio session opened successfully.');
                this._isConnected = true;
                this.props.onStateChange('connected');
                this.audioPlayer.start();
            },
            onclose: (e: CloseEvent) => {
                console.log(`ℹ️ Live API audio session closed. Code: ${e.code}, Reason: ${e.reason}`);
                this._isConnected = false;
                this.props.onStateChange('disconnected');
                this.props.onError(e.reason);
                this.audioPlayer.stop();
            },
            onerror: (e: ErrorEvent) => {
                console.error('🔴 Live API audio session error:', e.message);
                this._isConnected = false;
                this.props.onError(e.message);
                this.props.onStateChange('error');
                this.audioPlayer.stop();
            },
            onmessage: (message: LiveServerMessage) => this.handleServerMessage(message),
        };
        
        const speechConfig: any = {
            languageCode: this.props.languageCode,
        };
        if (this.props.voiceName) {
            speechConfig.voiceConfig = { prebuiltVoiceConfig: { voiceName: this.props.voiceName } };
        }
        const config: LiveConnectConfig = {
            responseModalities: [Modality.AUDIO],
            speechConfig,
        };

        console.log(`Attempting to connect to audio session with config: `, config);

        try {
            // IMPORTANT: Use the specialized model for this endpoint.
            this.session = await this.ai.live.connect({
                model: 'gemini-2.5-flash-preview-native-audio-dialog',
                config: config,
                callbacks: liveCallbacks,
            });
        } catch (e: any) {
            this.props.onError(e.message);
            this.props.onStateChange('error');
            throw e;
        }
    }

    public isConnected(): boolean {
        return this._isConnected;
    }

    public close(): void {
        this.session?.close();
        this.session = null;
        this._isConnected = false;
    }
    
    public sendText(text: string, turnComplete: boolean): void {
        if (!this.session || !this._isConnected) {
            console.warn('Cannot send text for synthesis, session not active.');
            return;
        }
        if (!text && !turnComplete) {
            return;
        }
        if (!text && turnComplete) {
            this.session.sendClientContent({ turnComplete });
            return;
        }
        const content = { role: 'user', parts: [{ text }] as Part[] };
        this.session.sendClientContent({ turns: [content], turnComplete });
    }

    public sendAudio(chunk: Blob): void {
        if (!this.session) throw new Error(ERROR_SESSION_NOT_ACTIVE);
        const reader = new FileReader();
        reader.onload = () => {
            const base64data = (reader.result as string).split(',')[1];
            this.session!.sendRealtimeInput({
                media: { mimeType: 'audio/webm;codecs=opus', data: base64data }
            });
        };
        reader.readAsDataURL(chunk);
    }
}