/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useStore from '../lib/store';
import c from 'clsx';
import modes from '../lib/modes';
import { handleFilterClick, setCustomPrompt, toggleSettingsModal, toggleAboutModal, openTokenDetailModal } from '../lib/actions';
import { useVoiceAgent } from '../hooks/useVoiceAgent';
import VoiceActivityIndicator from './VoiceActivityIndicator';

const capitalize = (s: string) => (s && s.length > 0) ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export default function Chat() {
  const chatHistory = useStore.use.chatHistory();
  const customPrompt = useStore.use.customPrompt();
  const apiKey = useStore.use.apiKey();
  const activeAgent = useStore.use.activeAgent();
  const activeCustomAgent = useStore.use.activeCustomAgent();
  const activeModelUrl = useStore.use.activeModelUrl();
  const models = useStore.use.models();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Determine current agent details (custom takes precedence)
  const currentAgentDetails = activeCustomAgent || models.find(m => m.url === activeModelUrl);
  const systemInstruction = currentAgentDetails?.systemInstruction;
  const agentName = currentAgentDetails?.name || (activeAgent === 'boudicca' ? 'Young Boudicca' : 'Eliza');
  const agentIcon = activeCustomAgent ? '✨' : (activeAgent === 'boudicca' ? '🏴󠁧󠁢󠁳󠁣󠁴󠁿' : '🤖');

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

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isAssistantThinkingOrSpeaking, streamingSummary]);

  const handleSendMessage = async () => {
    const text = customPrompt.trim();
    if (text) {
      setCustomPrompt('');
      await sendText(text);
    }
  };

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

      <div className="filter-selector">
        <h3>Quick Filters</h3>
        <div className="filter-chips">
          {Object.entries(modes).map(([key, { name, emoji }]: [string, { name: string; emoji: string }]) => (
            <button key={key} className="filter-chip" onClick={() => handleFilterClick(key)}>
              {emoji} {name}
            </button>
          ))}
        </div>
      </div>

      <div className="chat-input-area">
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
        />
        {isSpeechRecognitionSupported && (
            <button className={c('mic-button', { listening: isListening })} onClick={toggleListening} title={isListening ? "Stop listening" : "Start listening"}>
                <span className="icon">{isListening ? 'mic_off' : 'mic'}</span>
            </button>
        )}
        <button
            onClick={handleSendMessage}>
          <span className="icon">send</span>
        </button>
      </div>
    </div>
  )
}

function renderToolCard(name: string, data: any) {
  switch (name) {
    case 'fetchTrendingTokens':
    case 'fetchBondingTokens':
    case 'fetchGraduatedTokens':
    case 'fetchLatestTokens':
    case 'fetchTokenList':
      return renderTokenList(Array.isArray(data) ? data : [])
    case 'fetchToken':
      return renderTokenDetails(data)
    case 'getTokenMetadata':
      return renderMetadataCard(data)
    case 'getMarketInfo':
      return renderMarketInfoCard(data)
    case 'fetchCandles':
      return renderCandlesSummary(data)
    default:
      return renderKeyValue(data)
  }
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
                {t.website && <a href={t.website} target="_blank">Website</a>}
                {t.dexscreenerUrl && <a href={t.dexscreenerUrl} target="_blank">DexScreener</a>}
                {t.solscanUrl && <a href={t.solscanUrl} target="_blank">Solscan</a>}
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
                return <a href={v} target="_blank">{v}</a>;
            }
            return v;
        case 'object':
            return <code style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(v, null, 2)}</code>;
        default:
            return String(v);
    }
}

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