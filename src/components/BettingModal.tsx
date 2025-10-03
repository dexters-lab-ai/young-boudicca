import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import useStore from '../lib/store';
import { toggleBettingModal } from '../lib/actions';
import { MonacoMarket, MonacoMarketOutcome, MonacoUserBet } from '../types';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

/**
 * Converts a Unix timestamp (in seconds) to a human-readable relative time string
 * @param timestamp Unix timestamp in seconds
 * @returns Human-readable time difference (e.g., "2h ago", "in 3d")
 */
const timeAgo = (timestamp: number | string | null | undefined): string => {
    if (timestamp === null || timestamp === undefined) return 'Unknown time';
    
    // Convert to number and handle string timestamps
    const timestampMs = typeof timestamp === 'string' 
        ? isNaN(Number(timestamp)) 
            ? new Date(timestamp).getTime() 
            : Number(timestamp) * 1000
        : timestamp * 1000; // Convert seconds to milliseconds
    
    // Check if the timestamp is valid
    if (isNaN(timestampMs)) {
        console.error('Invalid timestamp:', timestamp);
        return 'Invalid date';
    }
    
    const now = Date.now();
    const secondsAgo = Math.floor((now - timestampMs) / 1000);
    const minute = 60; 
    const hour = minute * 60; 
    const day = hour * 24;
    const month = day * 30;
    const year = day * 365;
    
    if (secondsAgo < 0) {
        // Future date
        const secondsInFuture = -secondsAgo;
        if (secondsInFuture < minute) return `in ${secondsInFuture}s`;
        if (secondsInFuture < hour) return `in ${Math.floor(secondsInFuture / minute)}m`;
        if (secondsInFuture < day) return `in ${Math.floor(secondsInFuture / hour)}h`;
        if (secondsInFuture < month) return `in ${Math.floor(secondsInFuture / day)}d`;
        if (secondsInFuture < year) return `in ${Math.floor(secondsInFuture / month)}mo`;
        return `in ${Math.floor(secondsInFuture / year)}y`;
    } else {
        // Past date
        if (secondsAgo < 60) return 'just now';
        if (secondsAgo < hour) return `${Math.floor(secondsAgo / minute)}m ago`;
        if (secondsAgo < day) return `${Math.floor(secondsAgo / hour)}h ago`;
        if (secondsAgo < month) return `${Math.floor(secondsAgo / day)}d ago`;
        if (secondsAgo < year) return `${Math.floor(secondsAgo / month)}mo ago`;
        return `${Math.floor(secondsAgo / year)}y ago`;
    }
};

const BettingModal: React.FC = () => {
    const { publicKey, signMessage } = useWallet();
    const [activeTab, setActiveTab] = useState<'markets' | 'my-bets'>('markets');
    const [markets, setMarkets] = useState<MonacoMarket[]>([]);
    const [userBets, setUserBets] = useState<MonacoUserBet[]>([]);
    // FIX: Correct the type for selectedMarket to match the API response shape { market, outcomes }.
    const [selectedMarket, setSelectedMarket] = useState<{ market: MonacoMarket; outcomes: MonacoMarketOutcome[] } | null>(null);
    const [betAmount, setBetAmount] = useState<string>('10');
    const [selectedOutcomeId, setSelectedOutcomeId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isPlacingBet, setIsPlacingBet] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // FIX: Corrected bettingModalMarketId to bettingModalMarketPk
    const initialMarketId = useStore.use.bettingModalMarketPk();

    const fetchMarkets = useCallback(async () => {
        setIsLoading(true);
        try {
            // FIX: Corrected API path from /api/pnp/markets to /api/monaco/markets
            const res = await fetch('/api/monaco/markets');
            const data = await res.json();
            setMarkets(data.markets || []);
            if (initialMarketId) {
                handleMarketSelect(initialMarketId);
            }
        } catch (err) {
            setError('Failed to load markets.');
        } finally {
            setIsLoading(false);
        }
    }, [initialMarketId]);

    const fetchUserBets = useCallback(async () => {
        if (!publicKey) return;
        setIsLoading(true);
        try {
            // FIX: Corrected API path from /api/pnp/bets/user/ to /api/monaco/orders/user/
            const res = await fetch(`/api/monaco/orders/user/${publicKey.toBase58()}`);
            const data = await res.json();
            // FIX: Use the 'bets' property from the API response
            setUserBets(data.bets || []);
        } catch (err) {
            setError('Failed to load your bets.');
        } finally {
            setIsLoading(false);
        }
    }, [publicKey]);

    useEffect(() => {
        if (activeTab === 'markets') {
            fetchMarkets();
        } else {
            fetchUserBets();
        }
    }, [activeTab, fetchMarkets, fetchUserBets]);

    const handleMarketSelect = async (marketId: string) => {
        setIsLoading(true);
        setError(null);
        try {
            // FIX: Corrected API path from /api/pnp/market/ to /api/monaco/market/
            const res = await fetch(`/api/monaco/market/${marketId}`);
            if (!res.ok) throw new Error('Market not found.');
            const data = await res.json();
            setSelectedMarket(data);
            setSelectedOutcomeId(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePlaceBet = async () => {
        if (!publicKey || !signMessage || !selectedMarket || selectedOutcomeId === null) return;

        setIsPlacingBet(true);
        setError(null);
        try {
            const message = new TextEncoder().encode(`Place bet of ${betAmount} on outcome index ${selectedOutcomeId} in market ${selectedMarket.market.id}`);
            // Signing the message for future verification
            await signMessage(message);
            
            // FIX: Corrected API path from /api/pnp/bets/place to /api/monaco/orders/place
            const response = await fetch('/api/monaco/orders/place', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    marketPk: selectedMarket.market.id,
                    outcomeIndex: selectedOutcomeId,
                    forAgainst: 'for', // Defaulting to 'for' bet
                    amount: Number(betAmount),
                    walletAddress: publicKey.toBase58(),
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to place bet.');
            
            // TODO: The UI should handle the serialized transaction returned from the server
            // and prompt the user to sign it with their wallet.
            
            setSelectedMarket(null);
            setActiveTab('my-bets');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsPlacingBet(false);
        }
    };

    const renderMarkets = () => (
        <div className="betting-content">
            {isLoading && !selectedMarket && <p>Loading markets...</p>}
            {error && <p className="error-message">{error}</p>}
            {markets.map(market => (
                <div key={market.id} className="market-item" onClick={() => handleMarketSelect(market.id)}>
                    <h4>{market.title}</h4>
                    <p>Closes {timeAgo(market.marketLockTimestamp)}</p>
                </div>
            ))}
        </div>
    );
    
    const renderMarketDetail = () => {
        if (!selectedMarket) return null;
        const selectedOutcome = selectedMarket.outcomes.find(o => o.id === selectedOutcomeId);
        const potentialWinnings = selectedOutcome ? (Number(betAmount) * selectedOutcome.odds).toFixed(2) : '0.00';
        return (
            <div className="betting-content detail-view">
                <button className="back-button" onClick={() => setSelectedMarket(null)}><span className="icon">arrow_back</span> Markets</button>
                {/* FIX: Access market properties via selectedMarket.market */}
                <h3>{selectedMarket.market.title}</h3>
                <div className="outcomes-grid">
                    {selectedMarket.outcomes.map(outcome => (
                        <button 
                            key={outcome.id} 
                            className={`outcome-item ${selectedOutcomeId === outcome.id ? 'selected' : ''}`}
                            onClick={() => setSelectedOutcomeId(outcome.id)}
                        >
                            <span className="outcome-title">{outcome.title}</span>
                            <span className="outcome-odds">{outcome.odds.toFixed(2)}x</span>
                        </button>
                    ))}
                </div>
                <div className="bet-slip">
                    <div className="bet-amount-input">
                        <input type="number" value={betAmount} onChange={e => setBetAmount(e.target.value)} min="1" step="1" />
                        <span>USDC</span>
                    </div>
                    <button onClick={handlePlaceBet} disabled={selectedOutcomeId === null || isPlacingBet || !publicKey}>
                        {isPlacingBet ? 'Placing Bet...' : `Bet ${betAmount} USDC`}
                    </button>
                </div>
                {selectedOutcomeId !== null && <p className="winnings-preview">Potential Winnings: {potentialWinnings} USDC</p>}
                {!publicKey && <div className="wallet-prompt-small"><p>Connect your wallet to place a bet.</p><WalletMultiButton/></div>}
            </div>
        )
    }

    const renderMyBets = () => {
        // Sort bets by creationTimestamp in descending order (newest first)
        const sortedBets = [...userBets].sort((a, b) => {
            // Fallback to 0 for missing timestamps to sort them at the end
            const timeA = a.creationTimestamp || 0;
            const timeB = b.creationTimestamp || 0;
            return timeB - timeA; // Sort newest first
        });

        return (
            <div className="betting-content">
                {!publicKey ? (
                    <div className="wallet-prompt-large">
                        <p>Connect your wallet to see your bets.</p>
                        <WalletMultiButton/>
                    </div>
                ) : isLoading ? (
                    <p>Loading your bets...</p>
                ) : sortedBets.length === 0 ? (
                    <p>You haven't placed any bets yet.</p>
                ) : (
                    <div className="bets-list">
                        {sortedBets.map(bet => (
                            <div key={bet.id} className="user-bet-item">
                                <div className="bet-info">
                                    <div className="bet-header">
                                        <h4>{bet.marketTitle}</h4>
                                        <span className="bet-time">
                                            {bet.creationTimestamp ? timeAgo(bet.creationTimestamp) : 'Time unknown'}
                                        </span>
                                    </div>
                                    <p>
                                        You bet <strong>{bet.stake} USDC</strong> on "{bet.outcomeTitle}"
                                    </p>
                                    {bet.marketLockTimestamp && (
                                        <p className="market-closes">
                                            Market {bet.marketLockTimestamp * 1000 > Date.now() ? 'closes' : 'closed'}: {timeAgo(bet.marketLockTimestamp)}
                                        </p>
                                    )}
                                </div>
                                <div className={`bet-status ${bet.status?.toLowerCase() || 'pending'}`}>
                                    {bet.status || 'Pending'}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="modal-backdrop betting-modal" onClick={() => toggleBettingModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="close-button" onClick={() => toggleBettingModal(false)}>
                    <span className="icon">close</span>
                </button>
                <div className="modal-header">
                    <h2>Monaco Protocol Exchange</h2>
                     <div className="tab-headers">
                        <button className={activeTab === 'markets' ? 'active' : ''} onClick={() => { setActiveTab('markets'); setSelectedMarket(null); }}>Markets</button>
                        <button className={activeTab === 'my-bets' ? 'active' : ''} onClick={() => { setActiveTab('my-bets'); setSelectedMarket(null); }}>My Bets</button>
                    </div>
                </div>
                {activeTab === 'markets' ? (selectedMarket ? renderMarketDetail() : renderMarkets()) : renderMyBets()}
            </div>
        </div>
    );
};

export { BettingModal };