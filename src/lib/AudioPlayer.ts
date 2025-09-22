/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { ttsPlaybackProcessorCode } from './realtime';

/**
 * A streaming audio player for raw PCM data, using an AudioWorklet for low-latency,
 * gapless playback. It also reports playback state changes.
 */
export class AudioPlayer {
    private audioContext: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private onPlaybackStateChange: (isPlaying: boolean) => void;
    private isInitialized = false;

    constructor(onPlaybackStateChange: (isPlaying: boolean) => void = () => {}) {
        this.onPlaybackStateChange = onPlaybackStateChange;
        if (typeof window !== 'undefined') {
            try {
                this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            } catch (e) {
                console.error("Web Audio API is not supported in this browser.", e);
            }
        }
    }

    async start() {
        if (this.isInitialized || !this.audioContext) return;
        
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (e) {
                console.error("Failed to resume AudioContext:", e);
                return;
            }
        }

        try {
            // Use a data URI for robust worklet loading, avoiding potential Blob/URL timing issues.
            const workletCode = `data:application/javascript;base64,${btoa(ttsPlaybackProcessorCode)}`;
            await this.audioContext.audioWorklet.addModule(workletCode);
            
            this.workletNode = new AudioWorkletNode(this.audioContext, 'tts-playback-processor');
            
            this.workletNode.port.onmessage = (event) => {
                if (event.data.type === 'ttsPlaybackStarted') {
                    this.onPlaybackStateChange(true);
                } else if (event.data.type === 'ttsPlaybackStopped') {
                    this.onPlaybackStateChange(false);
                }
            };

            this.workletNode.connect(this.audioContext.destination);
            this.isInitialized = true;
            console.log('[AudioPlayer] Worklet started and connected.');
        } catch (e) {
            console.error('Error setting up AudioWorklet:', e);
            this.isInitialized = false; // Allow retrying if setup fails
        }
    }

    /**
     * Enqueues a chunk of raw PCM audio data for playback.
     * @param pcmChunk An ArrayBuffer containing 16-bit PCM audio data.
     */
    enqueue(pcmChunk: ArrayBuffer) {
        if (this.workletNode && pcmChunk.byteLength > 0) {
            const int16Data = new Int16Array(pcmChunk);
            this.workletNode.port.postMessage(int16Data, [int16Data.buffer]);
        }
    }

    /**
     * Immediately stops playback and clears any buffered audio.
     */
    stop() {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'clear' });
        }
    }

    /**
     * Sets the sample rate for the audio context.
     * This will re-initialize the AudioContext and WorkletNode.
     * @param sampleRate The new sample rate.
     */
    async setSampleRate(sampleRate: number) {
        if (this.audioContext && this.audioContext.sampleRate === sampleRate) {
            return;
        }

        console.log(`[AudioPlayer] Setting sample rate to ${sampleRate}`);
        this.isInitialized = false;
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            await this.audioContext.close();
        }

        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: sampleRate,
            });
            await this.start();
        } catch (e) {
            console.error("Failed to create new AudioContext with sample rate:", sampleRate, e);
        }
    }
}