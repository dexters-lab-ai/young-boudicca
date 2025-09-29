<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Boudi AI - The Warrior Queen of the Digital Age

Boudi AI is a next-generation, multimodal AI companion application that brings a 3D virtual character to life. Inspired by the trending "Young Boudicca" meme, the application provides a dynamic and engaging way to interact with an AI that can see, hear, and speak, while also providing powerful, live data from the crypto world.

This project serves as a cutting-edge demonstration of **Personified AI Agents**, showcasing how combining a compelling narrative with powerful AI tools can create an experience that is more than just a utility—it's an alliance.

## ✨ Core Features

-   **Real-time Voice Conversation:** Chat with your 3D agent via text or voice. The app uses the browser's built-in Speech-to-Text, Google's Gemini for lightning-fast responses, and ElevenLabs for high-quality, low-latency voice synthesis.
-   **Dynamic 3D Avatars:** Interact with fully animated 3D character models (VRM) that feature realistic lip-syncing, dynamic facial expressions, and gesture animations, bringing the agent's personality to life.
-   **Custom Agent Creation & Sharing:** Go beyond the defaults! Users can create, customize, and share their own AI agents. Define a personality, upload a unique 3D model, and even set custom animations and environments.
-   **Live Crypto Toolkit:** Boudicca is empowered with Gemini Function Calling to access a suite of on-chain tools. Get live market data for trending, bonding, and new Solana tokens, fetched securely via the Solscan API.
-   **AI-Powered Meme Generator:** Create witty, shareable memes with custom captions generated on the fly by the Gemini model.
-   **Dual-Agent System:** Seamlessly switch between the fiery, voice-driven **Boudicca** and her analytical, text-only sister agent, **Eliza**, for different interaction styles.
-   **Customizable Environments:** Set the scene for your conversation. Users can select from default backgrounds or assign a unique environment to their custom-created agents.

## 🤖 The Personas

-   **Young Boudicca:** A fierce, 16-year-old Scottish warrior from Glasgow. She's a crypto-anarchist who sees decentralization as the ultimate rebellion against the "fiat Romans." She's sassy, protective, and armed with a sharp wit.
-   **Eliza:** Boudicca's sister. An analytical, data-driven AI agent who communicates exclusively through text. She provides concise, professional insights for crypto traders, acting as a calm counterpart to Boudicca's fiery personality.

## 🛠️ Technology & Architecture

The application is built with a modern, secure, and performant tech stack.

-   **Frontend:** React, TypeScript, Vite, Zustand (for state management).
-   **3D Rendering:** Three.js & React Three Fiber power the 3D stage, with `@pixiv/three-vrm` for avatar and animation handling.
-   **Backend:** A lightweight Node.js server using Express and `tsx`. It acts as a secure proxy for all external API services and handles database interactions.
-   **Database:** MongoDB (via Mongoose) for storing user-created AI agents.
-   **AI & Generative Services:**
    -   **Google Gemini (`gemini-2.5-flash`):** The core language model for chat, reasoning, and function calling.
    -   **Browser `SpeechRecognition` API:** Provides fast, free, and efficient Speech-to-Text.
    -   **ElevenLabs API:** Used for high-quality, real-time Text-to-Speech, proxied through our secure backend.
-   **Blockchain Data:** Solscan API for all live crypto market data.
-   **Wallet Integration:** Solana Wallet Adapter for connecting user wallets to sign and verify ownership for agent creation.

## 🚀 Running Locally

**Prerequisites:** Node.js v18+

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/boudi-ai.git
    cd boudi-ai
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up Environment Variables:**
    -   Create a file named `.env` in the root of the project.
    -   Add your API keys to this file. See `.env.example` for the required format. You will need keys for:
        -   **Google Gemini:** `GEMINI_API_KEY`
        -   **ElevenLabs:** `VITE_ELEVENLABS_API_KEY`
        -   **Solscan:** `SOLSCAN_API_KEY` (For crypto tools)
        -   **MongoDB:** `MONGODB_URI` (For custom agent creation)

4.  **Run the application:**
    -   The `dev:all` script runs both the backend server and the frontend client concurrently.
    ```bash
    npm run dev:all
    ```

    Your application will be running at `http://localhost:5173`. The server runs on port `8787`.