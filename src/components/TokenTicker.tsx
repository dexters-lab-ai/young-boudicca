/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useMemo } from 'react';
import { TickerToken } from '../types';
import { openTokenDetailModal } from '../lib/actions';

const formatPrice = (price?: number) => {
  if (price === undefined || price === null) return 'N/A';
  if (price < 0.0001 && price > 0) return `$${price.toPrecision(2)}`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: price > 1 ? 2 : 6,
  }).format(price);
};

const formatPercent = (percent?: number) => {
    if (percent === undefined || percent === null) return null;
    const isPositive = percent >= 0;
    return (
        <span style={{color: isPositive ? '#35c759' : '#ff453a'}}>
            {isPositive ? '▲' : '▼'}&nbsp;{Math.abs(percent).toFixed(2)}%
        </span>
    );
};

const BONDING_PLATFORMS = {
    bags_launchpad: 'Bags',
    believe_launchpad: 'Believe',
    jupiter: 'Jupiter',
    jup_studio_launchpad: 'Jupiter Studio',
    kamino: 'Kamino',
    letsbonkfun_launchpad: 'LetsBonkFun',
    meteora: 'Meteora',
    moonshot_launchpad: 'Moonshot',
    orca: 'Orca',
    pumpfun: 'Pump.fun',
    raydium: 'Raydium'
};

const TokenTicker: React.FC = () => {
  const [tokens, setTokens] = useState<TickerToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listType, setListType] = useState<'trending' | 'bonding'>('trending');
  const [platform, setPlatform] = useState<string>('pumpfun');

  useEffect(() => {
    const fetchTickerData = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/tools/fetchTokenList', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: listType, platform: listType === 'bonding' ? platform : undefined })
            });
            if (response.ok) {
                const result = await response.json();
                setTokens(result.data || []);
            }
        } catch (err) {
            console.error("Failed to fetch ticker tokens:", err);
            setTokens([]);
        } finally {
            setIsLoading(false);
        }
    };
    
    fetchTickerData();
    const intervalId = setInterval(fetchTickerData, 120000); 
    return () => clearInterval(intervalId);
  }, [listType, platform]);

  const marqueeTokens = useMemo(() => {
    if (!tokens || tokens.length === 0) return [];
    return [...tokens, ...tokens];
  }, [tokens]);

  const animationDuration = useMemo(() => {
    // Each token takes about 0.4 seconds to scroll past.
    // A lower number means faster scrolling.
    const secondsPerToken = 0.4; 
    return tokens.length * secondsPerToken;
  }, [tokens]);

  const TickerContent = () => {
    if (isLoading) {
        return <span className="token-item">Loading tokens...</span>;
    }
    if (!tokens || tokens.length === 0) {
        return <span className="token-item">No tokens found.</span>;
    }
    return (
        <div className="marquee" style={animationDuration > 0 ? { animationDuration: `${animationDuration}s` } : {}}>
            {marqueeTokens.map((token, index) => (
                <button
                    key={`${token.tokenAddress}-${index}`}
                    onClick={() => openTokenDetailModal(token.tokenAddress)}
                    className="token-item"
                    title={`${token.name} (${token.symbol})`}
                >
                    <img src={token.logo} alt={token.symbol} className="w-5 h-5 rounded-full" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    <span className="symbol">{token.symbol}</span>
                    <span className="price">{formatPrice(token.priceUsd)}</span>
                    {formatPercent(token.priceChange24h)}
                </button>
            ))}
        </div>
    );
  };
  
  return (
    <>
      <div className="token-ticker-controls">
        <select value={listType} onChange={e => setListType(e.target.value as any)} title="Select token list">
            <option value="trending">Trending</option>
            <option value="bonding">Bonding</option>
        </select>
        {listType === 'bonding' && (
             <select value={platform} onChange={e => setPlatform(e.target.value)} title="Select launchpad platform">
                {Object.entries(BONDING_PLATFORMS).sort((a, b) => a[1].localeCompare(b[1])).map(([key, name]) => (
                    <option key={key} value={key}>{name}</option>
                ))}
            </select>
        )}
      </div>
      <div className="token-ticker">
        <TickerContent />
      </div>
    </>
  );
};

export default TokenTicker;