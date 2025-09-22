/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useEffect, useRef } from 'react';
import useStore from '../lib/store';
import c from 'clsx';
import { setCustomPrompt, toggleSettingsModal, toggleAboutModal } from '../lib/actions';
import { useElizaAgent } from '../hooks/useElizaAgent';


export default function ElizaChat() {
  const chatHistory = useStore.use.chatHistory();
  const customPrompt = useStore.use.customPrompt();
  const addReaction = useStore.use.addReaction();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { isAssistantTyping, sendMessage } = useElizaAgent();

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

  return (
    <div className="chat-container">
      <div className="chat-header">
        <span className="chat-header-icon">{agentIcon}</span>
        <h2>{agentName}</h2>
        <button
            className="header-button"
            onClick={() => toggleAboutModal(true)}
            title="About Boudi AI"
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
        />
        <button onClick={handleSendMessage}>
          <span className="icon">send</span>
        </button>
      </div>
    </div>
  )
}