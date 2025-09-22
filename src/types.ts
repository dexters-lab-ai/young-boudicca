/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface Photo {
  id: string;
  mode: string;
  isBusy: boolean;
  isInitial: boolean; // True for the original default, uploaded, or webcam photos
}

export interface Mode {
  name: string;
  emoji: string;
  prompt: string;
}

export interface ChatMessage {
  id:string;
  role: 'user' | 'assistant';
  text: string;
  sources?: {uri: string, title: string}[];
  reactions?: string[];
  tool?: { name: string; data: any };
}

export type InputSource = 'default' | 'upload' | 'webcam';

export interface HistoryItem {
    id: string;
    query: string;
    results: { summary: string } | null;
}

export interface ToolCall {
    id: string;
    name: string;
    status: 'working' | 'success' | 'error';
    result: any;
    args: any;
}

/** The lifecycle state of the live voice session. */
export type SessionState = 'idle' | 'connecting' | 'connected' | 'listening' | 'thinking' | 'speaking' | 'disconnected' | 'error' | 'reconnecting';

export interface FavouriteToken {
    address: string;
    name: string;
    symbol: string;
    logo?: string;
}

export type AgentName = 'boudicca' | 'eliza';

export interface TickerToken {
  tokenAddress: string;
  name: string;
  symbol: string;
  logo: string;
  priceUsd?: number;
  priceChange24h?: number;
  dexscreenerUrl?: string;
}

export interface Agent {
  _id: string;
  name: string;
  description: string;
  systemInstruction: string;
  vrmUrl: string;
  creatorWalletAddress: string;
  createdAt: string;
}