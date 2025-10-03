/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useState, useEffect } from 'react';
import useStore from '../lib/store';
import { closeTokenDetailModal } from '../lib/actions';
import SparklineChart from './SparklineChart';
import '../styles/TokenDetailModal.css';

const capitalize = (s: string) => (s && s.length > 0) ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const formatNumber = (num?: number, options: Intl.NumberFormatOptions = {}) => {
    if (num === undefined || num === null || isNaN(num)) return 'N/A';
    const isCurrency = options.style !== 'decimal';

    if (Math.abs(num) >= 1e9) {
        return `${isCurrency ? '$' : ''}${(num / 1e9).toFixed(2)}B`;
    }
    if (Math.abs(num) >= 1e6) {
        return `${isCurrency ? '$' : ''}${(num / 1e6).toFixed(2)}M`;
    }
    if (Math.abs(num) >= 1e3) {
        return `${isCurrency ? '$' : ''}${(num / 1e3).toFixed(2)}K`;
    }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: num > 1 ? 2 : 6,
        ...options,
    }).format(num);
};

const formatPercentForCard = (percent?: number) => {
    if (percent === undefined || percent === null || isNaN(percent)) {
        return <span className="value-neutral">N/A</span>;
    }
    const isPositive = percent >= 0;
    const sign = isPositive ? '▲' : '▼';
    const className = isPositive ? 'value-up' : 'value-down';

    return (
        <span className={className}>
            {sign} {Math.abs(percent).toFixed(2)}%
        </span>
    );
};


const timeAgo = (timestamp?: number): string => {
    if (!timestamp) return 'N/A';
    
    // The API returns seconds, convert to milliseconds for Date constructor
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const secondsAgo = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (isNaN(secondsAgo) || secondsAgo < 0) return 'Invalid date';
    
    const minute = 60;
    const hour = minute * 60;
    const day = hour * 24;
    const week = day * 7;
    const month = day * 30;
    const year = day * 365;
    
    if (secondsAgo < minute) {
        return 'just now';
    } else if (secondsAgo < hour) {
        const minutes = Math.floor(secondsAgo / minute);
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    } else if (secondsAgo < day) {
        const hours = Math.floor(secondsAgo / hour);
        return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    } else if (secondsAgo < week) {
        const days = Math.floor(secondsAgo / day);
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    } else if (secondsAgo < month) {
        const weeks = Math.floor(secondsAgo / week);
        return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    } else if (secondsAgo < year) {
        const months = Math.floor(secondsAgo / month);
        return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    } else {
        const years = Math.floor(secondsAgo / year);
        return `${years} ${years === 1 ? 'year' : 'years'} ago`;
    }
};

const truncateAddress = (address?: string) => {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
};


export default function TokenDetailModal() {
    const address = useStore.use.tokenDetailModalAddress();
    const [tokenData, setTokenData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!address) return;
        
        const fetchDetails = async () => {
            setIsLoading(true);
            setError(null);
            setTokenData(null);
            try {
                const response = await fetch('/tools/fetchToken', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mint: address })
                });
                if (!response.ok) {
                    throw new Error('Token not found or API error.');
                }
                const result = await response.json();
                setTokenData(result.data);
            } catch (err: any) {
                setError(err.message || 'Failed to fetch token details.');
            } finally {
                setIsLoading(false);
            }
        };

        fetchDetails();
    }, [address]);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleClose = () => closeTokenDetailModal();

    const renderContent = () => {
        if (isLoading) {
            return <div className="media-overlay shimmer">Loading Token Data...</div>;
        }
        if (error || !tokenData) {
            return <div style={{ textAlign: 'center', color: '#ff453a' }}>{error || 'No data available.'}</div>;
        }

        const candlePrices = tokenData.candles?.map((c: any) => c.price);
        const hasLinks = tokenData.solscanUrl || tokenData.dexscreenerUrl || (tokenData.socials && Object.keys(tokenData.socials).length > 0);

        return (
            <div className="token-detail-content">
                <div className="token-detail-left">
                    <div className="token-detail-header">
                        <a href={tokenData.dexscreenerUrl} target="_blank" rel="noopener noreferrer" className="token-header-link" title="View on DexScreener">
                            <img src={tokenData.logo} alt={tokenData.symbol} onError={(e: any) => { e.currentTarget.style.display = 'none' }}/>
                            <h2>
                                {tokenData.name}
                                {tokenData.createdOn && <span className="platform-badge">{tokenData.createdOn}</span>}
                            </h2>
                            <div className="symbol">{tokenData.symbol}</div>
                        </a>
                    </div>
                    
                    <div className="token-address-container">
                        <span className="label">Token Address</span>
                        <div className="address-line">
                            <a href={tokenData.dexscreenerUrl} target="_blank" rel="noopener noreferrer" className="address-text" title="View on DexScreener">
                                {tokenData.tokenAddress}
                            </a>
                            <button onClick={() => handleCopy(tokenData.tokenAddress)} title="Copy address">
                                <span className="icon">{copied ? 'done' : 'content_copy'}</span>
                            </button>
                        </div>
                    </div>

                    {tokenData.description && (
                        <div className="token-detail-description">
                            {tokenData.description}
                        </div>
                    )}

                    <div className="token-info-section">
                        {tokenData.createdTime && (
                             <div className="info-item">
                                <span className="label">Created</span>
                                <span className="value">{timeAgo(tokenData.createdTime)}</span>
                            </div>
                        )}
                        {tokenData.creatorAddress && (
                            <div className="info-item">
                                <span className="label">Creator</span>
                                <span className="value">
                                    <a href={`https://solscan.io/account/${tokenData.creatorAddress}`} target="_blank" rel="noopener noreferrer">
                                        {truncateAddress(tokenData.creatorAddress)}
                                    </a>
                                </span>
                            </div>
                        )}
                        {tokenData.supply && (
                             <div className="info-item">
                                <span className="label">Total Supply</span>
                                <span className="value">{formatNumber(Number(tokenData.supply), { style: 'decimal', currency: undefined, maximumFractionDigits: 0, notation: 'compact' })}</span>
                            </div>
                        )}
                    </div>
                    
                    {hasLinks && (
                        <div className="token-detail-links">
                            {tokenData.solscanUrl && <a href={tokenData.solscanUrl} target="_blank" rel="noopener noreferrer" className="details-button">Solscan</a>}
                            {tokenData.dexscreenerUrl && <a href={tokenData.dexscreenerUrl} target="_blank" rel="noopener noreferrer" className="details-button">DexScreener</a>}
                            {tokenData.socials && Object.entries(tokenData.socials).map(([name, url]) => (
                                url && <a key={name} href={url as string} target="_blank" rel="noopener noreferrer" className="details-button social-link">{capitalize(name)}</a>
                            ))}
                        </div>
                    )}
                </div>
                <div className="token-detail-right">
                    <div className="token-detail-kpi-grid">
                        <div className="token-detail-kpi-card">
                            <div className="label">Price</div>
                            <div className="value">{formatNumber(tokenData.priceUsd)}</div>
                        </div>
                         <div className="token-detail-kpi-card">
                            <div className="label">24h Change</div>
                            <div className="value">
                                {formatPercentForCard(tokenData.priceChange24h)}
                            </div>
                        </div>
                         <div className="token-detail-kpi-card">
                            <div className="label">Market Cap</div>
                            <div className="value">{formatNumber(tokenData.marketCap)}</div>
                        </div>
                         <div className="token-detail-kpi-card">
                            <div className="label">MCap Rank</div>
                            <div className="value">#{tokenData.marketCapRank ? new Intl.NumberFormat().format(tokenData.marketCapRank) : 'N/A'}</div>
                        </div>
                         <div className="token-detail-kpi-card">
                            <div className="label">24h Volume</div>
                            <div className="value">{formatNumber(tokenData.volume24h)}</div>
                        </div>
                         <div className="token-detail-kpi-card">
                            <div className="label">Holders</div>
                            <div className="value">{tokenData.holderCount ? new Intl.NumberFormat().format(tokenData.holderCount) : 'N/A'}</div>
                        </div>
                    </div>
                    <div className="sparkline-container">
                        <SparklineChart data={candlePrices} />
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="modal-backdrop token-detail-modal" onClick={handleClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="close-button" onClick={handleClose}>
                    <span className="icon">close</span>
                </button>
                {renderContent()}
            </div>
        </div>
    );
}