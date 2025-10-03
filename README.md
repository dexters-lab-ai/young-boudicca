<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Miko AI - Your 3D AI Companion Platform

**Miko AI** is a next-generation, multimodal AI platform that empowers creators to bring unique 3D virtual companions to life as one-of-a-kind NFTs on the Solana blockchain. Go beyond static JPEGs and build interactive AI agents with distinct personalities, voices, and animations that others can subscribe to and interact with.

This project pioneers the concept of **Personified AI Agents**, creating a new digital economy where creativity, AI, and blockchain technology intersect. It's more than an app—it's a launchpad for your digital creations.

## ✨ Core Features

-   **AI Companion NFT Creator:** Design and mint unique 3D AI agents as NFTs on the Solana blockchain. Each NFT's metadata links directly to the unique assets (VRM model, animations), ensuring verifiable ownership and rarity.
-   **Creator Economy & Subscriptions:** Monetize your creations! Other users can subscribe to your public agents by paying a small fee in Solana-based tokens (like USDC), sent directly to your wallet. You earn 75% of all subscription revenue.
-   **Real-time Voice Conversation:** Chat with agents via text or voice. The app uses the browser's built-in Speech-to-Text, Google's Gemini for lightning-fast responses, and ElevenLabs for high-quality, low-latency voice synthesis.
-   **Dynamic 3D Avatars:** Interact with fully animated 3D character models (VRM) that feature realistic lip-syncing, dynamic facial expressions, and custom gesture animations.
-   **Live Crypto & Betting Toolkit:** Agents are empowered with Gemini Function Calling to access a suite of on-chain tools. Get live market data for Solana tokens or browse and place bets on the PNP Prediction Market Exchange.
-   **Creator Dashboard:** Manage your created agents, view subscriber counts, track earnings, and toggle their public visibility all from a simple interface.

## 🤖 Meet Miko

-   **Default Agent:** The platform's default agent is **Miko**, a cheerful, knowledgeable, and helpful AI guide ready to assist you with on-chain data, creative tasks, or a friendly chat.
-   **User-Created Agents:** The true magic comes from the community. Create anyone or anything—from historical figures like Einstein to entirely new fictional characters—each with its own look, personality, and on-chain identity.

## 🛠️ Technology & Architecture

The application is built with a modern, secure, and performant tech stack.

-   **Frontend:** React, TypeScript, Vite, Zustand (for state management).
-   **3D Rendering:** Three.js & React Three Fiber power the 3D stage, with `@pixiv/three-vrm` for avatar and animation handling.
-   **Backend:** A lightweight Node.js server using Express and `tsx`. It acts as a secure proxy for all external API services and handles database interactions.
-   **Database:** MongoDB (via Mongoose) for storing user and agent metadata, including NFT details and subscription information.
-   **AI & Generative Services:**
    -   **Google Gemini (`gemini-2.5-flash`):** The core language model for chat, reasoning, and function calling.
    -   **Browser `SpeechRecognition` API:** Provides fast, free, and efficient Speech-to-Text.
    -   **ElevenLabs API:** Used for high-quality, real-time Text-to-Speech, proxied through our secure backend.
-   **Blockchain & NFTs:**
    -   **Solana:** The high-performance blockchain for all NFT and token-based interactions.
    -   **Metaplex Umi:** The conceptual framework for minting and managing NFTs via the backend.
    -   **Solana Wallet Adapter:** For connecting user wallets to sign transactions and verify ownership.
-   **Asset Hosting:** Users can host their VRM and VRMA files on any service with a direct public URL, such as **echo3D** or a properly configured **Google Drive** link.

## 🚀 Running Locally

**Prerequisites:** Node.js v18+

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/miko-ai.git
    cd miko-ai
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up Environment Variables:**
    -   Create a file named `.env` in the root of the project.
    -   Add your API keys to this file. See `INSTRUCTIONS.md` for the required keys. You will need:
        -   **Google Gemini:** `GEMINI_API_KEY`
        -   **ElevenLabs:** `ELEVENLABS_API_KEY`
        -   **Solscan:** `SOLSCAN_API_KEY` (For crypto tools)
        -   **MongoDB:** `MONGODB_URI` (For custom agent creation)

4.  **Run the application:**
    -   The `dev:all` script runs both the backend server and the frontend client concurrently.
    ```bash
    npm run dev:all
    ```

    Your application will be running at `http://localhost:5173`. The server runs on port `8787`.