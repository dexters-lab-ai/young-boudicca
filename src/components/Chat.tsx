/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import c from 'classnames';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useStore from '../lib/store';
import modes from '../lib/modes';
import { handleFilterClick, setCustomPrompt, toggleSettingsModal, toggleAboutModal, openTokenDetailModal, toggleSubscriptionModal, toggleBettingModal, generateSoraVideo } from '../lib/actions';
import { useVoiceAgent } from '../hooks/useVoiceAgent';
import VoiceActivityIndicator from './VoiceActivityIndicator';
import { useWallet } from '@solana/wallet-adapter-react';
// FIX: Corrected import from Pnp... to Monaco... types
import { MonacoMarket, MonacoMarketOutcome, MonacoUserBet } from '../types';
import { useTransactionSender } from '../hooks/useTransactionSender';
import useSoraPolling from '../hooks/useSoraPolling';
import imageData from '../lib/imageData';

import '../styles/Chat.css';

const capitalize = (s: string) => (s && s.length > 0) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const DEFAULT_IMAGE_ID = 'default-image';

export default function Chat() {
  const { publicKey } = useWallet();
  const chatHistory = useStore.use.chatHistory();
  const customPrompt = useStore.use.customPrompt();
  const apiKey = useStore.use.apiKey();
  const activeAgent = useStore.use.activeAgent();
  const activeCustomAgent = useStore.use.activeCustomAgent();
  const activeModelUrl = useStore.use.activeModelUrl();
  const models = useStore.use.models();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const subscriptionStatus = useStore.use.subscriptionStatus();
  const setSubscriptionStatus = useStore.use.setSubscriptionStatus();
  
  const [isCheckingSub, setIsCheckingSub] = useState(false);
  const [isBalanceSufficient, setIsBalanceSufficient] = useState(false);
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);
  const [activeTab, setActiveTab] = useState<'filters' | 'sora'>('filters');
  const [soraPrompt, setSoraPrompt] = useState<string>(modes.sora.prompt);
  const [soraAspectRatio, setSoraAspectRatio] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [soraRemoveWatermark, setSoraRemoveWatermark] = useState<boolean>(true);
  const [soraError, setSoraError] = useState<string | null>(null);
  const [isSoraSubmitting, setIsSoraSubmitting] = useState<boolean>(false);
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });

  const soraPricingCopy = useMemo(() => 'Sora 2 beta · 30 credits (~$0.15) per 10s video with audio. Limit 3 videos/hour per wallet.', []);

  const photoGallery = useStore.use.photos();
  const soraVideos = useMemo(() => photoGallery.filter(p => p.mediaType === 'video'), [photoGallery]);
  const hasUserImage = useMemo(
    () => photoGallery.some(p => p.mediaType === 'image' && p.id !== DEFAULT_IMAGE_ID && !p.isBusy),
    [photoGallery]
  );
  const soraButtonTitle = hasUserImage ? 'Use the current uploaded image to generate a video in Sora.' : 'Upload or capture an image first.';

  useSoraPolling();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handler = (event: MediaQueryListEvent) => setIsCompactViewport(event.matches);
    setIsCompactViewport(mediaQuery.matches);
    try {
      mediaQuery.addEventListener('change', handler);
    } catch {
      // Safari < 14 fallback
      mediaQuery.addListener(handler);
    }
    return () => {
      try {
        mediaQuery.removeEventListener('change', handler);
      } catch {
        mediaQuery.removeListener(handler);
      }
    };
  }, []);

  const isSoraTabActive = activeTab === 'sora';
  const disableChatInput = isSoraTabActive && !isCompactViewport;

  const handleSoraGenerate = useCallback(async () => {
    if (!hasUserImage) {
      setSoraError('Upload or capture an image first.');
      setActiveTab('sora');
      return;
    }

    const trimmedPrompt = soraPrompt.trim();
    if (!trimmedPrompt) {
      setSoraError('Describe the motion you want Sora to create.');
      setActiveTab('sora');
      return;
    }

    setSoraError(null);
    setIsSoraSubmitting(true);
    try {
      await generateSoraVideo(trimmedPrompt, {
        aspectRatio: soraAspectRatio === 'auto' ? undefined : soraAspectRatio,
        removeWatermark: soraRemoveWatermark,
      });
      setActiveTab('sora');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start Sora video generation.';
      setSoraError(message);
      setActiveTab('sora');
    } finally {
      setIsSoraSubmitting(false);
    }
  }, [hasUserImage, soraPrompt, soraAspectRatio, soraRemoveWatermark]);

  // Determine current agent details (custom takes precedence)
  const currentAgentDetails = activeCustomAgent || models.find(m => m.url === activeModelUrl);
  const systemInstruction = currentAgentDetails?.systemInstruction;
  const agentName = currentAgentDetails?.name || (activeAgent === 'gemini' ? 'Miko' : 'Eliza');
  const agentIcon = activeCustomAgent ? '✨' : (activeAgent === 'gemini' ? '🤖' : '🤖');

  const { 
    streamingSummary,
    isProcessing,
    isListening,
    sendText,
    toggleListening,
    isSpeechRecognitionSupported
  } = useVoiceAgent({
    apiKey,
    systemInstruction: systemInstruction || undefined,
  });

  const isAssistantThinkingOrSpeaking = isProcessing || streamingSummary;

  const isCustomAgentPublic = activeCustomAgent && activeCustomAgent.isPublic;
  const currentSubStatus = activeCustomAgent ? subscriptionStatus[activeCustomAgent._id] : undefined;
  
  const isSubscribedToCustom = !isCustomAgentPublic || (currentSubStatus?.isSubscribed ?? false);

  const checkSubscription = useCallback(async () => {
    if (!isCustomAgentPublic || !publicKey) {
        if (activeCustomAgent) {
            setSubscriptionStatus(activeCustomAgent._id, { isSubscribed: !isCustomAgentPublic });
        }
        return;
    }
    setIsCheckingSub(true);
    try {
        const res = await fetch(`/api/users/subscription-status/${activeCustomAgent._id}?walletAddress=${publicKey.toBase58()}`);
        const data = await res.json();
        setSubscriptionStatus(activeCustomAgent._id, { isSubscribed: !!data.isSubscribed, expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined });
    } catch (err) {
        console.error("Failed to check subscription status", err);
        setSubscriptionStatus(activeCustomAgent._id, { isSubscribed: false });
    } finally {
        setIsCheckingSub(false);
    }
  }, [isCustomAgentPublic, publicKey, activeCustomAgent, setSubscriptionStatus]);

  const checkBalance = useCallback(async () => {
    if (activeCustomAgent || !publicKey) {
        setIsBalanceSufficient(true);
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
  }, [publicKey, activeCustomAgent]);

  useEffect(() => {
    if (activeCustomAgent) {
      checkSubscription();
    } else {
      checkBalance();
    }
  }, [checkSubscription, checkBalance, activeCustomAgent]);


  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isAssistantThinkingOrSpeaking, streamingSummary]);

  useEffect(() => {
    const hasActiveSoraJob = soraVideos.some(video => video.isBusy || imageData.tasks[video.id]?.status === 'waiting');
    if (hasActiveSoraJob) {
      setActiveTab('sora');
    }
  }, [soraVideos]);

  const handleSendMessage = async () => {
    const text = customPrompt.trim();
    if (text) {
      setCustomPrompt('');
      await sendText(text);
    }
  };
  
  const handleSubscribe = () => {
    if (activeCustomAgent) {
      toggleSubscriptionModal(true, activeCustomAgent._id);
    }
  };

  const isChatLocked = activeCustomAgent ? !isSubscribedToCustom : !isBalanceSufficient;
  const isCheckingPermissions = isCheckingSub || isCheckingBalance;

  return (
    <div className="chat-container">
      <div className="chat-header">
        <span className="chat-header-icon">{agentIcon}</span>
        <h2>{agentName}</h2>
        <button
            className="header-button"
            onClick={() => toggleAboutModal(true)}
            title="About Miko AI"
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
                {msg.text && (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.text}
                  </ReactMarkdown>
                )}
                {msg.reactions && msg.reactions.length > 0 && (
                    <div className="reactions">{[...new Set(msg.reactions)].join(' ')}</div>
                )}
              </div>
              {msg.role === 'assistant' && msg.tool && (
                <div className="tool-card-container">
                  {renderToolCard(msg.tool.name, msg.tool.data)}
                </div>
              )}
              {msg.role === 'assistant' && (
                <div className="message-actions">
                    <button onClick={() => useStore.getState().addReaction(msg.id, '🔥')} title="Add Fire reaction">🔥</button>
                    <button onClick={() => useStore.getState().addReaction(msg.id, '🛡️')} title="Add Shield reaction">🛡️</button>
                </div>
              )}
            </div>
             {msg.sources && msg.sources.length > 0 && msg.role === 'assistant' && (
              <div className="sources-container">
                <strong>Sources:</strong>
                {msg.sources.map((source, index) => (
                  <a key={index} href={source.uri} target="_blank" rel="noopener noreferrer" className="source-link" title={source.uri}>
                     {index + 1}. {source.title || new URL(source.uri).hostname}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
        {isAssistantThinkingOrSpeaking && (
          <div className="message assistant">
            <div className="message-bubble">
              {streamingSummary && (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {streamingSummary}
                </ReactMarkdown>
              )}
              {!streamingSummary && isProcessing && (
                <div className="typing-indicator">
                  <span /><span /><span />
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="filter-selector tabs">
        <div className="tab-headers compact">
          <button
            className={activeTab === 'filters' ? 'active' : ''}
            onClick={() => setActiveTab('filters')}
          >
            Image Filters
          </button>
          <button
            className={activeTab === 'sora' ? 'active' : ''}
            onClick={() => setActiveTab('sora')}
          >
            Sora Video
          </button>
        </div>
        <div className="tab-body">
          {activeTab === 'filters' && (
            <div className="filter-chips">
              {Object.entries(modes)
                .filter(([key]) => key !== 'sora')
                .map(([key, { name, emoji }]: [string, { name: string; emoji: string }]) => (
                  <button key={key} className="filter-chip" onClick={() => handleFilterClick(key)}>
                    {emoji} {name}
                  </button>
                ))}
            </div>
          )}
          {activeTab === 'sora' && (
            <div className="sora-panel">
              <div className="sora-info" title={soraPricingCopy}>
                <span className="icon">movie</span>
                <strong>Sora video (beta)</strong>
                <span className="sora-meta">30 credits (~$0.15) · 10s with audio · 3/hr limit</span>
              </div>
              <form
                className="sora-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSoraGenerate();
                }}
              >
                <label className="sora-field">
                  <span>Prompt</span>
                  <textarea
                    value={soraPrompt}
                    onChange={(event) => setSoraPrompt(event.target.value)}
                    placeholder="Describe how the subject should move, the scene, mood, camera, etc."
                    rows={isCompactViewport ? 3 : 4}
                    disabled={isSoraSubmitting}
                  />
                </label>
                <div className="sora-inline">
                  <label>
                    <span>Aspect ratio</span>
                    <select
                      value={soraAspectRatio}
                      onChange={(event) => setSoraAspectRatio(event.target.value as 'auto' | 'portrait' | 'landscape')}
                      disabled={isSoraSubmitting}
                    >
                      <option value="auto">Auto</option>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </label>
                  <label className="sora-toggle">
                    <input
                      type="checkbox"
                      checked={soraRemoveWatermark}
                      onChange={(event) => setSoraRemoveWatermark(event.target.checked)}
                      disabled={isSoraSubmitting}
                    />
                    <span>Remove watermark</span>
                  </label>
                </div>
                {soraError && <p className="sora-error">{soraError}</p>}
                <div className="sora-actions">
                  <button
                    className="primary"
                    type="submit"
                    disabled={!hasUserImage || isSoraSubmitting}
                    title={soraButtonTitle}
                  >
                    <span className="icon">{isSoraSubmitting ? 'hourglass_top' : 'play_circle'}</span>
                    {isSoraSubmitting ? 'Starting…' : 'Generate video'}
                  </button>
                </div>
                {!hasUserImage && (
                  <p className="sora-hint">Upload or capture an image to unlock Sora generation.</p>
                )}
              </form>
              {soraVideos.length > 0 && (
                <div className="sora-gallery">
                  {soraVideos.map(video => {
                    const videoMeta = imageData.videos[video.id];
                    const taskMeta = imageData.tasks[video.id];
                    return (
                      <div key={video.id} className="sora-card">
                        {video.isBusy || taskMeta?.status === 'waiting' ? (
                          <div className="sora-card-pending">
                            <div className="spinner" />
                            <p>Rendering video…</p>
                          </div>
                        ) : videoMeta?.url ? (
                          <video
                            controls
                            poster={videoMeta.thumbnail}
                            src={videoMeta.url}
                            preload="metadata"
                          />
                        ) : (
                          <div className="sora-card-error">
                            <span className="icon">error</span>
                            <p>{taskMeta?.error || 'Video unavailable'}</p>
                          </div>
                        )}
                        <div className="sora-card-footer">
                          <span className="status">{taskMeta?.status ?? (video.isBusy ? 'waiting' : 'unknown')}</span>
                          {videoMeta?.url && (
                            <a href={videoMeta.url} download target="_blank" rel="noopener noreferrer">
                              <span className="icon">download</span>
                              Download
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={c('chat-input-area', { disabled: disableChatInput })}>
        {isChatLocked && (
            <div className="subscription-gate-overlay">
                <div className="gate-content">
                    <span className="icon">lock</span>
                    {activeCustomAgent ? (
                        <>
                            <p>Subscribe to chat with this agent.</p>
                            <button onClick={handleSubscribe} disabled={isCheckingPermissions}>
                                {isCheckingPermissions ? 'Checking...' : 'Subscribe to Unlock'}
                            </button>
                        </>
                    ) : (
                        <>
                            <p>Requires ≥ $10 USDC in wallet.</p>
                             <button disabled={isCheckingPermissions}>
                                {isCheckingPermissions ? 'Checking Balance...' : 'Add Funds to Chat'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        )}
        <VoiceActivityIndicator isActive={isListening} />
        <input
          type="text"
          placeholder={isListening ? "Listening..." : "Talk or type..."}
          value={customPrompt}
          onChange={e => setCustomPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          disabled={isChatLocked || isCheckingPermissions || disableChatInput}
        />
        {isSpeechRecognitionSupported && (
            <button className={c('mic-button', { listening: isListening })} onClick={toggleListening} title={isListening ? "Stop listening" : "Start listening"} disabled={isChatLocked || isCheckingPermissions}>
                <span className="icon">{isListening ? 'mic_off' : 'mic'}</span>
            </button>
        )}
        <button
            onClick={handleSendMessage}
            disabled={isChatLocked || isCheckingPermissions || !customPrompt.trim() || disableChatInput}
        >
          <span className="icon">send</span>
        </button>
        {disableChatInput && (
          <span className="sora-chat-hint">Sora tab is active. Use the Sora form above.</span>
        )}
      </div>
    </div>
  )
}

function MonacoPlaceOrderCard({ data }: { data: any }) {
    const { send, status, signature, error, reset } = useTransactionSender();
    const { outcomeIndex, amount } = data.args;
    const { wallet } = useWallet();
    
    // A more robust implementation would fetch market details to get the title
    const outcomeTitle = outcomeIndex === 0 ? 'YES' : (outcomeIndex === 1 ? 'NO' : `Outcome #${outcomeIndex}`);

    const handleConfirm = () => {
        if (data.data.serializedTransaction) {
            send(data.data.serializedTransaction);
        }
    };
    
    const getStatusMessage = () => {
        switch (status) {
            case 'sending': return 'Sending to wallet...';
            case 'confirming': return 'Confirming transaction...';
            case 'success': return 'Bet placed successfully!';
            case 'error': return `Error: ${error}`;
            default: return `Confirm ${amount} USDC bet on "${outcomeTitle}"`;
        }
    };

    if (!wallet) {
        return (
            <div className="tool-card pnp-bet-confirmation-card">
                 <p>Connect your wallet to confirm this bet.</p>
            </div>
        );
    }
    
    if (status === 'success') {
         return (
             <div className="tool-card pnp-bet-confirmation-card">
                 <div className={`tx-status ${status}`}>{getStatusMessage()}</div>
                 {signature && (
                     <a href={`https://solscan.io/tx/${signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="tx-link">
                         View on Solscan <span className="icon small">open_in_new</span>
                     </a>
                 )}
             </div>
         );
    }

    return (
        <div className="tool-card pnp-bet-confirmation-card">
            <p>Miko has prepared a bet based on your request.</p>
            <div className="bet-details-summary">
                <span>Betting <strong>{amount} USDC</strong> on <strong>"{outcomeTitle}"</strong></span>
            </div>
            
            {status === 'idle' && (
                 <button className="details-button" onClick={handleConfirm}>
                    Confirm in Wallet
                </button>
            )}

            {(status === 'sending' || status === 'confirming' || status === 'error') && (
                <div className="tx-status-container">
                    <div className={`tx-status ${status}`}>{getStatusMessage()}</div>
                    {status === 'error' && (
                        <button className="details-button" onClick={reset} style={{marginTop: '10px'}}>
                           Try Again
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}


function renderToolCard(name: string, data: any) {
  switch (name) {
    case 'fetchTrendingTokens':
    case 'fetchBondingTokens':
    case 'fetchGraduatedTokens':
    case 'fetchLatestTokens':
    case 'fetchTokenList':
      return renderTokenList(data?.data ? data.data : [])
    case 'fetchToken':
      return renderTokenDetails(data?.data)
    case 'getTokenMetadata':
      return renderMetadataCard(data?.data)
    case 'getMarketInfo':
      return renderMarketInfoCard(data?.data)
    case 'fetchCandles':
      return renderCandlesSummary(data?.data)
    // FIX: Corrected tool names from Pnp... to Monaco...
    case 'listMonacoMarkets':
        return renderMonacoMarketList(data?.data);
    case 'getMonacoMarketDetails':
        return renderMonacoMarketDetails(data?.data);
    case 'listUserMonacoOrders':
        return renderUserMonacoBets(data?.data);
    case 'placeMonacoOrder':
        return <MonacoPlaceOrderCard data={data} />;
    default:
      return renderKeyValue(data)
  }
}

function renderMonacoMarketList(markets: MonacoMarket[]) {
    if (!markets || markets.length === 0) return <div className="tool-card">No open markets found.</div>;
    return (
        <div className="tool-card pnp-market-list">
            {markets.slice(0, 5).map(market => (
                <div key={market.id} className="pnp-market-item">
                    <div className="pnp-market-info">
                        <div className="pnp-market-title">{market.title}</div>
                        <div className="pnp-market-expiry">Closes in {timeAgo(market.marketLockTimestamp)}</div>
                    </div>
                    <button className="details-button" onClick={() => toggleBettingModal(true, market.id)}>
                        Place Bet
                    </button>
                </div>
            ))}
            {markets.length > 5 && <div className="pnp-market-item-footer">...and {markets.length - 5} more</div>}
        </div>
    );
}

function renderMonacoMarketDetails(data: { market: MonacoMarket, outcomes: MonacoMarketOutcome[] }) {
    if (!data || !data.market) return null;
    const { market, outcomes } = data;
    return (
         <div className="tool-card pnp-market-details">
            <div className="pnp-market-title">{market.title}</div>
            <div className="pnp-outcomes">
                {outcomes.map(outcome => (
                    <div key={outcome.id} className="pnp-outcome">
                        <span className="pnp-outcome-name">{outcome.title}</span>
                        <span className="pnp-outcome-odds">{outcome.odds.toFixed(2)}x</span>
                    </div>
                ))}
            </div>
            <div className="token-card-actions">
                <div className="links">
                    <div className="pnp-market-expiry">Closes in {timeAgo(market.marketLockTimestamp)}</div>
                </div>
                <button className="details-button" onClick={() => toggleBettingModal(true, market.id)}>
                    Place Bet
                </button>
            </div>
        </div>
    )
}

function renderUserMonacoBets(bets: MonacoUserBet[]) {
    if (!bets || bets.length === 0) return <div className="tool-card">You have no active bets.</div>;
     return (
        <div className="tool-card pnp-market-list">
             {bets.slice(0, 3).map(bet => (
                <div key={bet.id} className="pnp-market-item">
                    <div className="pnp-market-info">
                        <div className="pnp-market-title">{bet.marketTitle}</div>
                        <div className="pnp-bet-info">
                           Bet: <strong>{bet.stake} USDC</strong> on "{bet.outcomeTitle}"
                        </div>
                    </div>
                    <div className={`bet-status ${bet.status}`}>{bet.status}</div>
                </div>
            ))}
            {bets.length > 3 && <div className="pnp-market-item-footer">...and {bets.length - 3} more</div>}
             {/* FIX: Corrected bettingModalMarketId to bettingModalMarketPk */}
             <button className="details-button" style={{marginTop: '10px'}} onClick={() => { toggleBettingModal(true); useStore.setState({ bettingModalMarketPk: null }); }}>
                View All Bets
            </button>
        </div>
    );
}

function renderTokenList(list: any[]) {
  return (
    <div className="tool-card token-list">
      <div className="token-grid">
        {list.map((t: any) => (
          <div key={t.tokenAddress} className="token-card">
            <div className="token-header">
              <img src={t.logo} alt={t.symbol} onError={(e:any)=>{e.currentTarget.style.display='none'}} />
              <div className="token-title">
                <div className="symbol">{t.symbol}</div>
                <div className="name">{t.name}</div>
              </div>
            </div>
            <div className="kpi-row">
              <div className="kpi"><span>Price</span><strong>${fmtNum(t.priceUsd)}</strong></div>
              <div className={c('kpi', {'down': Number(t.priceChange24h) < 0, 'up': Number(t.priceChange24h) >= 0 })}> 
                <span>24h</span><strong>{fmtPct(t.priceChange24h)}</strong>
              </div>
            </div>
            <div className="kpi-row">
              <div className="kpi"><span>MCAP</span><strong>${fmtNum(t.marketCap)}</strong></div>
              <div className="kpi"><span>Vol 24h</span><strong>${fmtNum(t.volume24h)}</strong></div>
            </div>
            <div className="token-card-actions">
              <div className="links">
                {t.website && <a href={t.website} target="_blank" rel="noopener noreferrer">Website</a>}
                {t.dexscreenerUrl && <a href={t.dexscreenerUrl} target="_blank" rel="noopener noreferrer">DexScreener</a>}
                {t.solscanUrl && <a href={t.solscanUrl} target="_blank" rel="noopener noreferrer">Solscan</a>}
              </div>
               <button className="details-button" onClick={() => openTokenDetailModal(t.tokenAddress)}>
                    Details
                </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function renderTokenDetails(d: any) {
  if (!d) return null
  return (
    <div className="tool-card token-details">
      <div className="token-header">
        <img src={d.logo} alt={d.symbol} onError={(e:any)=>{e.currentTarget.style.display='none'}} />
        <div className="token-title">
          <div className="symbol">{d.symbol}</div>
          <div className="name">{d.name}</div>
        </div>
        <div className="token-badge">{d.pairLabel}</div>
      </div>
      <div className="kpi-row">
        <div className="kpi"><span>Price</span><strong>${fmtNum(d.priceUsd)}</strong></div>
        <div className={c('kpi', {'down': Number(d.priceChange24h) < 0, 'up': Number(d.priceChange24h) >= 0 })}> 
          <span>24h</span><strong>{fmtPct(d.priceChange24h)}</strong>
        </div>
        <div className="kpi"><span>MCap</span><strong>${fmtNum(d.marketCap)}</strong></div>
        <div className="kpi"><span>Liq</span><strong>${fmtNum(d.liquidityUsd)}</strong></div>
      </div>
      <div className="token-card-actions">
        <div className="links">
            {d.socials?.website && <a href={d.socials.website} target="_blank" rel="noopener noreferrer">Website</a>}
            {d.socials && Object.entries(d.socials).map(([name, url]) => (
            url && name !== 'website' && <a key={name} href={url as string} target="_blank" rel="noopener noreferrer" className="social-link">{capitalize(name)}</a>
            ))}
        </div>
        <button className="details-button" onClick={() => openTokenDetailModal(d.tokenAddress)}>
            Details
        </button>
      </div>
    </div>
  )
}

function renderMetadataCard(d: any) {
  if (!d) return null
  return (
    <div className="tool-card meta-card">
      {renderKeyValue({
            symbol: d.symbol,
        website: d.website,
        description: d.description,
        image: d?.metadata?.image || d.icon,
        metadata_uri: d.metadata_uri,
      })}
    </div>
  )
}

function renderMarketInfoCard(d: any) {
  if (!d) return null
  return (
    <div className="tool-card market-card">
      {renderKeyValue({
        market_name: d.market_name,
        market_address: d.market_address,
        price_usd: d.price_usd,
        price_change_24h: d.price_change_24h,
        volume_24h: d.volume_24h,
        liquidity_usd: d.liquidity_usd,
        market_cap_fully_diluted: d.market_cap_fully_diluted,
      })}
    </div>
  )
}

function renderCandlesSummary(list: any[]) {
  const n = Array.isArray(list) ? list.length : 0
  return (
    <div className="tool-card candles-card">
      <div className="kpi-row">
        <div className="kpi"><span>Candles</span><strong>{n}</strong></div>
        <div className="kpi"><span>Resolution</span><strong>{inferResolution(list)}</strong></div>
      </div>
    </div>
  )
}

function renderKeyValue(obj: any) {
  if (!obj) return null
  return (
    <div className="kv">
      {Object.entries(obj).map(([k, v]) => (
        <div className="kv-row" key={k}>
          <span className="k">{k}</span>
          <span className="v">{formatValue(k, v)}</span>
        </div>
      ))}
    </div>
  )
}

function formatValue(k: string, v: any): React.ReactNode {
    if (v == null) return '-';

    switch (typeof v) {
        case 'number':
            return new RegExp('price|usd|cap|liquidity|volume', 'i').test(k) ? `$${fmtNum(v)}` : fmtNum(v);
        case 'string':
            if (k === 'image') {
                return <img src={v} alt="img" style={{ maxWidth: 80, borderRadius: 8 }} onError={(e: any) => { e.currentTarget.style.display = 'none' }} />;
            }
            if (new RegExp('^https?://').test(v)) {
                return <a href={v} target="_blank" rel="noopener noreferrer">{v}</a>;
            }
            return v;
        case 'object':
            return <code style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(v, null, 2)}</code>;
        default:
            return String(v);
    }
}

function timeAgo(dateString?: string): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const now = new Date();
    const secondsAgo = Math.floor((now.getTime() - date.getTime()) / 1000);
    const minute = 60; const hour = minute * 60; const day = hour * 24;
    const week = day * 7; const month = day * 30;
    if (secondsAgo < day) return `${Math.floor(secondsAgo / hour)}h`;
    if (secondsAgo < week) return `${Math.floor(secondsAgo / day)}d`;
    if (secondsAgo < month) return `${Math.floor(secondsAgo / week)}w`;
    return date.toLocaleDateString();
};

function fmtNum(n: any) {
  const x = Number(n)
  if (!isFinite(x)) return '-'
  if (Math.abs(x) >= 1_000_000_000) return (x/1_000_000_000).toFixed(2)+'B'
  if (Math.abs(x) >= 1_000_000) return (x/1_000_000).toFixed(2)+'M'
  if (Math.abs(x) >= 1_000) return (x/1_000).toFixed(2)+'K'
  if (x === 0) return '0.00';
  if (Math.abs(x) < 0.000001) return x.toExponential(2);
  return x.toFixed(4).replace(/\.0+$/, '')
}

function fmtPct(n: any) {
  const x = Number(n)
  if (!isFinite(x)) return '-'
  const s = x.toFixed(2)+'%'
  return x>0? '+'+s : s
}

function inferResolution(list: any[]): string {
  if (!Array.isArray(list) || list.length < 2) return '-'
  return 'varies'
}