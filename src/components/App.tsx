/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as React from 'react';
import { useEffect } from 'react';
import Stage from './Stage';
import Chat from './Chat';
import About from './About';
import useStore from '../lib/store';
import ElizaChat from './ElizaChat';
import ErrorModal from './ErrorModal';
import TokenTicker from './TokenTicker';
import CreateAgentModal from './CreateAgentModal';
import WalletContextProvider from './WalletProvider';
import TokenDetailModal from './TokenDetailModal';
import VoiceSelector from './VoiceSelector';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import SubscriptionModal from './SubscriptionModal';
import { BettingModal } from './BettingModal';
import PaywallModal from './PaywallModal';
// FIX: Import Settings and Welcome modals
import Settings from './Settings';
import Welcome from './Welcome';
import { toggleWelcomeModal } from '../lib/actions';


import '../styles/App.css';
import '../styles/Modals.css';
import '../styles/BettingModal.css';

function AppContent() {
  const isAboutModalOpen = useStore.use.isAboutModalOpen();
  const isCreateAgentModalOpen = useStore.use.isCreateAgentModalOpen();
  const isTokenDetailModalOpen = useStore.use.isTokenDetailModalOpen();
  const isSubscriptionModalOpen = useStore.use.isSubscriptionModalOpen();
  const isBettingModalOpen = useStore.use.isBettingModalOpen();
  const isPaywallModalOpen = useStore.use.isPaywallModalOpen();
  // FIX: Get state for settings and welcome modals
  const isSettingsModalOpen = useStore.use.isSettingsModalOpen();
  const isWelcomeModalOpen = useStore.use.isWelcomeModalOpen();
  const activeAgent = useStore.use.activeAgent();
  const tempBackgroundUrl = useStore.use.tempBackgroundUrl();
  const error = useStore.use.error();
  const setError = useStore.use.setError();
  const activeEnvironmentUrl = useStore.use.activeEnvironmentUrl();
  const theme = useStore.use.theme();
  const toggleTheme = useStore.use.toggleTheme();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // FIX: Show welcome modal on first load if API key is not set
  useEffect(() => {
    if (!useStore.getState().apiKey) {
      toggleWelcomeModal(true);
    }
  }, []);

  return (
    <>
      <div className="main-background" style={{ backgroundImage: activeEnvironmentUrl ? `url(${activeEnvironmentUrl})` : 'none' }} />
      {tempBackgroundUrl && (
        <div 
          className="temp-background" 
          style={{ backgroundImage: `url(${tempBackgroundUrl})` }} 
        />
      )}
      <div className="app-header">
        <div className="token-ticker-container">
            <TokenTicker />
            <WalletMultiButton />
            <VoiceSelector />
            <button onClick={toggleTheme} className="theme-toggle-button" title="Toggle theme">
              <span className="icon">{theme === 'light' ? 'dark_mode' : 'light_mode'}</span>
            </button>
        </div>
      </div>
      {isAboutModalOpen && <About />}
      {isCreateAgentModalOpen && <CreateAgentModal />}
      {isTokenDetailModalOpen && <TokenDetailModal />}
      {isSubscriptionModalOpen && <SubscriptionModal />}
      {isBettingModalOpen && <BettingModal />}
      {isPaywallModalOpen && <PaywallModal />}
      {/* FIX: Render Settings and Welcome modals */}
      {isSettingsModalOpen && <Settings />}
      {isWelcomeModalOpen && <Welcome />}
      {error && <ErrorModal message={error} onClose={() => setError(null)} />}
      <main>
          <Stage />
          {activeAgent === 'gemini' ? <Chat /> : <ElizaChat />}
      </main>
    </>
  )
}

export default function App() {
  return (
    <WalletContextProvider>
      <AppContent />
    </WalletContextProvider>
  )
}