<div align="center">
<img width="1200" alt="AI Dreams - NFT AI Companions" src="https://raw.githubusercontent.com/dexters-lab-ai/young-boudicca/main/public/screenshot.png" />
</div>

# 🌟 AI Dreams - Your Gateway to the Future of Digital Companionship

**AI Dreams** is revolutionizing digital interaction by enabling creators to craft unique, interactive 3D AI companions as verifiable NFTs on the Solana blockchain. Unlike traditional static NFTs, these companions are living, breathing digital entities with distinct personalities, voices, and the ability to form meaningful connections with users worldwide.

## 🚀 The Next Evolution in Digital Ownership & The Creator Economy

AI Dreams isn't just another NFT platform—it's a paradigm shift in digital ownership and creator monetization. As a creator, you're not just selling an image; you're bringing to life intelligent companions that can be collected, customized, and cherished by users who subscribe to interact with them.

### For Creators:
- **True Digital Ownership**: When you create a companion, it's minted as a unique NFT on Solana that you own.
- **Recurring Revenue**: Set a per-use fee in USDC for your custom agents. Earn crypto directly to your wallet every time a user interacts with your creation.
- **Flexible & Easy Creation**: A polished creator studio allows you to define your agent's appearance, personality, animations, and monetization rules without writing any code.
- **Vibrant Ecosystem**: Be part of a growing community of creators pushing the boundaries of AI and digital art.

### For Collectors & Users:
- **Interact with Unique AI Beings**: Engage in real conversations, customize appearances, and form bonds with a diverse range of AI companions.
- **Support Creators Directly**: Your payments go directly to the artists and developers behind your favorite companions, fostering a healthy creator economy.
- **Freemium Access**: Enjoy a number of free interactions with our default platform agents before deciding to pay for more.
- **Seamless Crypto Payments**: Utilize a system inspired by the 402 protocol for simple, low-cost USDC payments on Solana to unlock conversations and features.

## ✨ Core Features

### 🎨 AI Companion Creation & Monetization
- **NFT-Based Ownership**: Each companion is a unique NFT on the Solana blockchain, ensuring true digital ownership and scarcity.
- **Creator-Set Pricing**: Creators can set their own per-interaction price in USDC for their custom agents.
- **Direct Payouts**: Creators specify their own Solana wallet to receive payments directly from users.
- **3D Character Customization**: Design unique 3D avatars with customizable appearances, outfits, and animations using .vrm and .vrma files.
- **Personality Engineering**: Craft distinct personalities, backstories, and behavioral traits for your companions using powerful system instructions.

### 🤖 Advanced AI Capabilities
- **Natural Conversations**: Powered by OpenAI's cutting-edge models for realistic, contextual dialogue and tool use, all handled securely on the server.
- **Voice Synthesis**: High-quality, expressive voice generation with emotional range via ElevenLabs.
- **On-Chain Awareness**: Agents can access live Solana blockchain data via Function Calling.
- **Multimodal Interaction**: Supports text, voice, and visual interactions, including powerful image-to-video generation with Sora.

## 🛠️ Technology Stack

AI Dreams is built with a modern, robust, and secure technology stack:

- **Frontend**: React, TypeScript, Vite, Zustand
- **3D Rendering**: Three.js & React Three Fiber with `@pixiv/three-vrm`
- **Backend**: Node.js, Express, tsx for secure API endpoints and AI orchestration.
- **Database**: MongoDB with Mongoose for user and agent data management.
- **AI & Voice**:
  - **OpenAI** for the core conversational engine and image generation (DALL-E).
  - ElevenLabs for high-quality voice synthesis.
  - Sora for image-to-video generation.
- **Blockchain**:
  - **Solana** for NFT minting and all payment transactions (USDC).
  - Metaplex Umi for NFT management.
  - Solana Wallet Adapter for secure wallet connections (Phantom, Solflare, etc.).

## 🚀 Local Development Setup

### Prerequisites
- Node.js v18 or higher
- npm or yarn package manager
- MongoDB instance (local or cloud)
- API keys for OpenAI, ElevenLabs, and Solscan.

### Quick Start

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-username/ai-dreams.git
    cd ai-dreams
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Set up environment variables**
    Create a `.env` file in the root `server/` directory with the variables listed in `INSTRUCTIONS.md`, including your API keys and a `MERCHANT_WALLET_ADDRESS` for receiving default model payments.

4.  **Start the development servers**
    In the root directory, run:
    ```bash
    # This single command starts both the frontend and backend servers concurrently.
    npm run dev:all
    ```

5.  **Access the application**
    - Frontend: http://localhost:3000
    - Backend API: http://localhost:8787

### Available Scripts

- `npm run dev` - Start frontend development server only.
- `npm run server` - Start backend server only.
- `npm run dev:all` - Start both frontend and backend servers.
- `npm run build` - Build for production.

## 🚀 Join the AI Dreams Revolution

### For Creators:
1. **Design** unique AI companions with custom personalities and appearances.
2. **Mint** your creation as an NFT on Solana.
3. **Set your price** and earn from every interaction.
4. **Grow** your community of fans and supporters.

### For Users:
1. **Discover** amazing AI companions created by talented artists.
2. **Connect** your wallet for a seamless experience.
3. **Interact** with your companions anytime, anywhere.
4. **Support** your favorite creators directly with USDC payments.

---

*AI Dreams is built on Solana for fast, low-cost transactions and true digital ownership. Join us in shaping the future of digital interaction and creator economies.*