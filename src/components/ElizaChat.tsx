/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useEffect, useRef, useState, useCallback } from 'react';
import useStore from '../lib/store';
import c from 'clsx';
// FIX: Add toggleSettingsModal to import
import { setCustomPrompt, toggleSettingsModal, toggleAboutModal } from '../lib/actions';
import { useElizaAgent } from '../hooks/useElizaAgent';
import { useWallet } from '@solana/wallet-adapter-react';

export default function ElizaChat() {
  const { publicKey } = useWallet();
  const chatHistory = useStore.use.chatHistory();
  const customPrompt = useStore.use.customPrompt();
  const addReaction = useStore.use.addReaction();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [isBalanceSufficient, setIsBalanceSufficient] = useState(false);
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);

  const { isAssistantTyping, sendMessage } = useElizaAgent();

  const checkBalance = useCallback(async () => {
    if (!publicKey) {
        setIsBalanceSufficient(false); // No wallet, no access
        return;
    }
    setIsCheckingBalance(true);
    try {
        const res = await fetch(`/api/users/wallet-balance?walletAddress=${publicKey.toBase58()}`);
        const data = await res.json();
        setIsBalanceSufficient(data.isSufficient);
    } catch (err) {
        console.error("Failed to check wallet balance", err);
        setIsBalanceSufficient(false);
    } finally {
        setIsCheckingBalance(false);
    }
  }, [publicKey]);

  useEffect(() => {
    checkBalance();
  }, [checkBalance]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isAssistantTyping]);

  const handleSendMessage = async () => {
    const text = customPrompt.trim();
    if (text) {
      sendMessage(text);
      setCustomPrompt('');
    }
  };

  const agentName = 'Eliza';
  const agentIcon = '🤖';
  const isChatLocked = !isBalanceSufficient;

  return (
    <div className="chat-container">
      <div className="chat-header">
        <span className="chat-header-icon">{agentIcon}</span>
        <h2>{agentName}</h2>
        <button
            className="header-button"
            onClick={() => toggleAboutModal(true)}
            title="About aiDreams"
        >
            <span className="icon">info</span>
        </button>
        <button
            className="header-button"
            onClick={() => toggleSettingsModal(true)}
            title="Open settings"
        >
            <span className="icon">settings</span>
        </button>
      </div>

      <div className="chat-history">
        {chatHistory.map(msg => (
          <div key={msg.id}>
            <div className={c('message', msg.role)}>
              <div className="message-bubble">
                {msg.text}
                {msg.reactions && msg.reactions.length > 0 && (
                    <div className="reactions">{[...new Set(msg.reactions)].join(' ')}</div>
                )}
              </div>
              {msg.role === 'assistant' && (
                <div className="message-actions">
                    <button onClick={() => addReaction(msg.id, '📈')} title="Add Chart Up reaction">📈</button>
                    <button onClick={() => addReaction(msg.id, '📉')} title="Add Chart Down reaction">📉</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {isAssistantTyping && (
          <div className="message assistant">
            <div className="message-bubble">
                <div className="typing-indicator">
                  <span /><span /><span />
                </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="chat-input-area">
        {isChatLocked && (
             <div className="subscription-gate-overlay">
                <div className="gate-content">
                    <span className="icon">lock</span>
                    <p>Requires ≥ $10 USDC in wallet.</p>
                     <button disabled={isCheckingBalance}>
                        {isCheckingBalance ? 'Checking Balance...' : 'Add Funds to Chat'}
                    </button>
                </div>
            </div>
        )}
        <input
          type="text"
          placeholder="Ask for crypto analysis..."
          value={customPrompt}
          onChange={e => setCustomPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          disabled={isChatLocked || isCheckingBalance}
        />
        <button onClick={handleSendMessage} disabled={isChatLocked || isCheckingBalance}>
          <span className="icon">send</span>
        </button>
      </div>
    </div>
  )
}