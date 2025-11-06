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
import ErrorModal from './ErrorModal';
import TokenTicker from './TokenTicker';
import CreateAgentModal from './CreateAgentModal';
import WalletContextProvider from './WalletProvider';
import TokenDetailModal from './TokenDetailModal';
import VoiceSelector from './VoiceSelector';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import SubscriptionModal from './SubscriptionModal';
import PaywallModal from './PaywallModal';


import '../styles/App.css';
import '../styles/Modals.css';

function AppContent() {
  const isAboutModalOpen = useStore.use.isAboutModalOpen();
  const isCreateAgentModalOpen = useStore.use.isCreateAgentModalOpen();
  const isTokenDetailModalOpen = useStore.use.isTokenDetailModalOpen();
  const isSubscriptionModalOpen = useStore.use.isSubscriptionModalOpen();
  const isPaywallModalOpen = useStore.use.isPaywallModalOpen();
  const error = useStore.use.error();
  const setError = useStore.use.setError();
  const activeEnvironmentUrl = useStore.use.activeEnvironmentUrl();
  const theme = useStore.use.theme();
  const toggleTheme = useStore.use.toggleTheme();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <>
      <div className="main-background" style={{ backgroundImage: activeEnvironmentUrl ? `url(${activeEnvironmentUrl})` : 'none' }} />
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
      {isPaywallModalOpen && <PaywallModal />}
      {error && <ErrorModal message={error} onClose={() => setError(null)} />}
      <main>
          <Stage />
          <Chat />
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