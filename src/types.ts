/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface Photo {
  id: string;
  mode: string;
  isBusy: boolean;
  isInitial: boolean; // True for the original default, uploaded, or webcam photos
  mediaType: 'image' | 'video';
  taskId?: string;
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
export type SessionState = 'idle' | 'connecting' | 'connected' | 'listening' | 'speaking' | 'disconnected' | 'error' | 'reconnecting';

export interface FavouriteToken {
    address: string;
    name: string;
    symbol: string;
    logo?: string;
}

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
  animationGreetingUrl?: string;
  animationDanceUrl?: string;
  animationSpinUrl?: string;
  animationPoseUrl?: string;
  animationPumpedUrl?: string;
  environmentUrl?: string;
  isPublic: boolean;
  unlockAmountUSDC: number;
  payoutWalletAddress?: string;
  network: 'Solana' | 'Base' | 'BSC';
  subscriptionCount: number;
  nftDetails?: {
    mintAddress: string;
    metadataUri: string;
    tokenStandard: string;
  };
}

export interface Environment {
    name: string;
    icon: string;
    url: string;
    musicPrompt: string;
}

export interface PaywallDetails {
  type: 'generic' | 'chat' | 'sora' | 'image';
  amount: number;
  recipient: string;
  currency: string;
  network: string;
  itemDescription: string;
  quantity?: number;
  originalRequest: (txSignature?: string) => Promise<any>;
}

export interface UserCredits {
  freePromptUsage: number;
  autonomyEnabled: boolean;
}

export interface AutonomyLog {
    _id: string;
    walletAddress: string;
    agentId: string;
    actionType: 'MONOLOGUE' | 'TOOL_CALL';
    text: string;
    createdAt: string;
}