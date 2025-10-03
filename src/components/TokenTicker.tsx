/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useMemo } from 'react';
import { TickerToken, MonacoMarket } from '../types';
import { openTokenDetailModal, toggleBettingModal } from '../lib/actions';
import '../styles/TokenTicker.css';

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

const TickerItem: React.FC<{ item: TickerToken | MonacoMarket }> = ({ item }) => {
    if ('tokenAddress' in item) { // It's a TickerToken
        return (
            <button
                onClick={() => openTokenDetailModal(item.tokenAddress)}
                className="token-item"
                title={`${item.name} (${item.symbol})`}
            >
                <img src={item.logo} alt={item.symbol} className="w-5 h-5 rounded-full" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span className="symbol">{item.symbol}</span>
                <span className="price">{formatPrice(item.priceUsd)}</span>
                {formatPercent(item.priceChange24h)}
            </button>
        );
    } else { // It's a MonacoMarket
        return (
             <button
                onClick={() => toggleBettingModal(true, item.id)}
                className="token-item"
                title={item.title}
            >
                <span className="icon" style={{ fontSize: '16px', color: 'var(--primary-color)' }}>paid</span>
                <span className="symbol market-title">{item.title}</span>
            </button>
        );
    }
};


const TokenTicker: React.FC = () => {
  const [items, setItems] = useState<(TickerToken | MonacoMarket)[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listType, setListType] = useState<'trending' | 'bonding' | 'markets'>('trending');
  const [platform, setPlatform] = useState<string>('pumpfun');

  useEffect(() => {
    const fetchTickerData = async () => {
        setIsLoading(true);
        try {
            let response: Response;
            if (listType === 'markets') {
                response = await fetch('/api/monaco/markets');
            } else {
                response = await fetch('/tools/fetchTokenList', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: listType, platform: listType === 'bonding' ? platform : undefined })
                });
            }
            
            if (response.ok) {
                const result = await response.json();
                setItems(result.data || result.markets || []);
            }
        } catch (err) {
            console.error("Failed to fetch ticker items:", err);
            setItems([]);
        } finally {
            setIsLoading(false);
        }
    };
    
    fetchTickerData();
    const intervalId = setInterval(fetchTickerData, 120000); 
    return () => clearInterval(intervalId);
  }, [listType, platform]);

  const marqueeItems = useMemo(() => {
    if (!items || items.length === 0) return [];
    return [...items, ...items];
  }, [items]);

  const animationDuration = useMemo(() => {
    // Each token takes about 0.4 seconds to scroll past.
    // A lower number means faster scrolling.
    const secondsPerItem = 0.4; 
    return items.length * secondsPerItem;
  }, [items]);

  const TickerContent = () => {
    if (isLoading) {
        return <span className="token-item">Loading...</span>;
    }
    if (!items || items.length === 0) {
        return <span className="token-item">No data found.</span>;
    }
    return (
        <div className="marquee" style={animationDuration > 0 ? { animationDuration: `${animationDuration}s` } : {}}>
            {marqueeItems.map((item, index) => (
                <TickerItem key={'tokenAddress' in item ? item.tokenAddress + index : item.id + index} item={item} />
            ))}
        </div>
    );
  };
  
  return (
    <>
      <div className="token-ticker-controls">
        <select value={listType} onChange={e => setListType(e.target.value as any)} title="Select list type">
            <option value="trending">Trending</option>
            <option value="bonding">Bonding</option>
            <option value="markets">Markets</option>
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