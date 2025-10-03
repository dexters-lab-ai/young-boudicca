/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import * as React from 'react';
import { useState } from 'react'
import useStore from '../lib/store'
import { addMessage, setActiveAgent } from '../lib/actions'
import '../styles/Filters.css';

function mapToolToEndpoint(name: string): { url: string; body: (args: any) => any } | null {
  switch (name) {
    case 'fetchTrendingTokens':
      return { url: '/tools/fetchTrendingTokens', body: (a) => ({ limit: a?.limit ?? 9 }) }
    case 'fetchLatestTokens':
      return { url: '/tools/fetchLatestTokens', body: (a) => ({ limit: a?.limit ?? 50 }) }
    case 'fetchBondingTokens':
      return { url: '/tools/fetchBondingTokens', body: (a) => ({ limit: a?.limit ?? 20 }) }
    default:
      return null
  }
}

async function callTool(name: string, args?: any) {
  try {
    const endpoint = mapToolToEndpoint(name)
    if (!endpoint) return null
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpoint.body(args || {})),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export default function Filters() {
  const [tab, setTab] = useState<'crypto' | 'games'>('crypto')
  const addToolMessage = useStore.use.addToolMessage()
  const activeAgent = useStore.use.activeAgent()

  const handleCrypto = async (name: 'fetchTrendingTokens' | 'fetchLatestTokens' | 'fetchBondingTokens') => {
    if (activeAgent !== 'gemini') {
      addMessage('Switch to the Gemini agent to use the advanced crypto tools.', 'assistant');
      return;
    }
    const result = await callTool(name)
    if (result && 'data' in result) {
      addToolMessage(name, (result as any).data)
    } else {
      addMessage(`Tool ${name} failed.`, 'assistant')
    }
  }

  const handleGameStub = (game: 'Minecraft' | 'Factorio') => {
    addMessage(`${game} integration is coming soon. What would you like to do there?`, 'assistant')
  }

  const handleElizaClick = () => {
    setActiveAgent('eliza');
    addMessage("Eliza activated. I am a data-driven crypto analyst agent. How may I assist you?", 'assistant');
  }

  return (
    <div className="filters tabs">
      <div className="tab-headers compact">
        <button className={tab==='crypto'? 'active':''} onClick={()=>setTab('crypto')}>Crypto</button>
        <button className={tab==='games'? 'active':''} onClick={()=>setTab('games')}>Games</button>
      </div>
      <div className="tab-body">
        {tab === 'crypto' && (
          <div className="tab-panel crypto">
            <div className="compact-grid">
              <button onClick={()=>handleCrypto('fetchTrendingTokens')} title="Trending tokens">
                <span className="icon">local_fire_department</span> Trending
              </button>
              <button onClick={()=>handleCrypto('fetchLatestTokens')} title="Latest tokens">
                <span className="icon">schedule</span> Latest
              </button>
              <button onClick={()=>handleCrypto('fetchBondingTokens')} title="Bonding">
                <span className="icon">auto_graph</span> Bonding
              </button>
              {/* Eliza Widget */}
              <button onClick={handleElizaClick} title="Activate Eliza Agent">
                <span className="icon">🤖</span> Eliza
              </button>
            </div>
          </div>
        )}
        {tab === 'games' && (
          <div className="tab-panel games">
            <div className="compact-grid">
              <button onClick={()=>handleGameStub('Minecraft')} title="Minecraft stub">
                <span className="icon">terrain</span> Minecraft
              </button>
              <button onClick={()=>handleGameStub('Factorio')} title="Factorio stub">
                <span className="icon">precision_manufacturing</span> Factorio
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}