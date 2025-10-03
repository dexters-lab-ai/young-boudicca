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
export type SessionState = 'idle' | 'connecting' | 'connected' | 'listening' | 'speaking' | 'disconnected' | 'error' | 'reconnecting';

export interface FavouriteToken {
    address: string;
    name: string;
    symbol: string;
    logo?: string;
}

export type AgentName = 'gemini' | 'eliza';

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

// Monaco Protocol Types
export interface MonacoMarket {
  id: string; // Public Key as string
  title: string;
  marketOutcomes: string[];
  marketStatus: object; // This is an enum-like object in the SDK
  marketType: string;
  marketLockTimestamp: string;
  // ... other fields from the SDK's MarketAccount
}

export interface MonacoMarketOutcome {
  id: number; // Index
  title: string;
  odds: number;
}

export interface MonacoOrder {
  publicKey: string;
  account: {
    purchaser: string;
    market: string;
    marketOutcomeIndex: number;
    forOutcome: boolean;
    stake: number;
    payout: number;
    // ... other fields from the SDK's OrderAccount
  };
}
// FIX: Standardizing on Monaco types and removing Pnp legacy types.
export interface MonacoUserBet {
  id: string;
  marketTitle: string;
  outcomeTitle: string;
  stake: number;
  payout: number;
  status: string;
  // Unix timestamp (seconds since epoch) when the bet was placed
  creationTimestamp?: number;
  // Unix timestamp (seconds since epoch) when the market locks/closes
  marketLockTimestamp?: number;
}
