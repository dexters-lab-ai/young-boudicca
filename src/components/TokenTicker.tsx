/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useMemo } from 'react';
import { TickerToken } from '../types';
import { openTokenDetailModal } from '../lib/actions';
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

const TickerItem: React.FC<{ item: TickerToken }> = ({ item }) => {
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
};


const TokenTicker: React.FC = () => {
  const [items, setItems] = useState<TickerToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTickerData = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/tools/fetchTokenList', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'trending' })
            });
            
            if (response.ok) {
                const result = await response.json();
                setItems(result.data || []);
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
  }, []);

  const marqueeItems = useMemo(() => {
    if (!items || items.length === 0) return [];
    return [...items, ...items];
  }, [items]);

  const animationDuration = useMemo(() => {
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
                <TickerItem key={item.tokenAddress + index} item={item} />
            ))}
        </div>
    );
  };
  
  return (
    <>
      <div className="token-ticker">
        <TickerContent />
      </div>
    </>
  );
};

export default TokenTicker;