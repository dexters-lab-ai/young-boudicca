/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import Stage from './Stage'
import Chat from './Chat'
import Welcome from './Welcome'
import Settings from './Settings'
import About from './About'
import useStore from '../lib/store';
import ElizaChat from './ElizaChat';
import ErrorModal from './ErrorModal';
import TokenTicker from './TokenTicker';
import CreateAgentModal from './CreateAgentModal';
import WalletContextProvider from './WalletProvider';
import TokenDetailModal from './TokenDetailModal';
import VoiceSelector from './VoiceSelector';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

function AppContent() {
  const isWelcomeModalOpen = useStore.use.isWelcomeModalOpen();
  const isSettingsModalOpen = useStore.use.isSettingsModalOpen();
  const isAboutModalOpen = useStore.use.isAboutModalOpen();
  const isCreateAgentModalOpen = useStore.use.isCreateAgentModalOpen();
  const isTokenDetailModalOpen = useStore.use.isTokenDetailModalOpen();
  const activeAgent = useStore.use.activeAgent();
  const tempBackgroundUrl = useStore.use.tempBackgroundUrl();
  const error = useStore.use.error();
  const setError = useStore.use.setError();

  return (
    <>
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
        </div>
      </div>
      {isWelcomeModalOpen && <Welcome />}
      {isSettingsModalOpen && <Settings />}
      {isAboutModalOpen && <About />}
      {isCreateAgentModalOpen && <CreateAgentModal />}
      {isTokenDetailModalOpen && <TokenDetailModal />}
      {error && <ErrorModal message={error} onClose={() => setError(null)} />}
      <main>
        <div className="container">
          <Stage />
          {activeAgent === 'boudicca' ? <Chat /> : <ElizaChat />}
        </div>
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
