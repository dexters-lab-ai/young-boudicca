/**
 * @fileoverview A true streaming audio player for the Gemini Live API.
 * 
 * This player is designed to handle raw PCM audio chunks as they arrive from the API,
 * scheduling them for seamless playback with low latency. It uses the Web Audio API
 * to manage the audio context, buffer scheduling, and playback, ensuring a smooth
 * and responsive conversational experience.
 */

export class StreamingAudioPlayer {
    private audioContext: AudioContext | null = null;
    private isPlaying = false;
    private sampleRate: number;
    private nextPlayTime = 0;

    constructor(sampleRate = 24000) { // Gemini API output is 24kHz
        this.sampleRate = sampleRate;
        if (typeof window !== 'undefined') {
            try {
                this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                    sampleRate: this.sampleRate,
                });
            } catch (e) {
                console.error("Web Audio API is not supported in this browser.", e);
            }
        }
    }

    public play(pcmData: ArrayBuffer) {
        if (!this.audioContext || pcmData.byteLength === 0 || !this.isPlaying) return;

        const frameCount = pcmData.byteLength / 2; // 16-bit PCM
        const audioBuffer = this.audioContext.createBuffer(1, frameCount, this.sampleRate);
        const channelData = audioBuffer.getChannelData(0);

        const int16View = new Int16Array(pcmData);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = int16View[i] / 32768.0;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        // Add to active sources
        this.activeSources.push(source);

        // Set up cleanup when playback finishes
        source.onended = () => {
            const index = this.activeSources.indexOf(source);
            if (index > -1) {
                this.activeSources.splice(index, 1);
            }
            source.disconnect();
        };

        try {
            const now = this.audioContext.currentTime;
            const startTime = this.nextPlayTime > now ? this.nextPlayTime : now;
            source.start(startTime);
            this.nextPlayTime = startTime + audioBuffer.duration;
        } catch (error) {
            console.error('Error starting audio playback:', error);
            source.disconnect();
            const index = this.activeSources.indexOf(source);
            if (index > -1) {
                this.activeSources.splice(index, 1);
            }
        }
    }

    public start() {
        if (this.isPlaying || !this.audioContext) return;
        this.isPlaying = true;
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        this.nextPlayTime = this.audioContext.currentTime;
    }

    private isStopping = false;
    private activeSources: AudioBufferSourceNode[] = [];

    public stop() {
        if (this.isStopping || !this.audioContext) {
            return;
        }

        this.isPlaying = false;
        this.isStopping = true;

        // Stop all active sources
        this.activeSources.forEach(source => {
            try {
                source.stop();
                source.disconnect();
            } catch (e) {
                console.warn('Error stopping audio source:', e);
            }
        });
        this.activeSources = [];

        // Only close the context if it's in a running or suspended state
        if (this.audioContext.state === 'running' || this.audioContext.state === 'suspended') {
            this.audioContext.close()
                .then(() => {
                    // Create a new context for future use
                    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                        sampleRate: this.sampleRate,
                    });
                })
                .catch(error => {
                    console.warn('Error closing audio context:', error);
                })
                .finally(() => {
                    this.isStopping = false;
                });
        } else {
            this.isStopping = false;
        }
    }

    public getIsPlaying(): boolean {
        return this.isPlaying;
    }
}