import React, { useState, useEffect, useCallback } from 'react';
import useStore from '../lib/store';
import { toggleCreateAgentModal, setActiveCustomAgent } from '../lib/actions';
import { Agent } from '../types';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';
import '../styles/CreateAgentModal.css';

const YourAgentsTab: React.FC<{ onAgentCreated: () => void }> = ({ onAgentCreated }) => {
    const { publicKey, signMessage } = useWallet();
    const [myAgents, setMyAgents] = useState<Agent[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchMyAgents = useCallback(async () => {
        if (publicKey) {
            setIsLoading(true);
            try {
                const res = await fetch(`/api/agents/creator/${publicKey.toBase58()}`);
                const data = await res.json();
                setMyAgents(data);
            } catch (err) {
                console.error("Failed to fetch user's agents", err);
            } finally {
                setIsLoading(false);
            }
        }
    }, [publicKey]);

    useEffect(() => {
        fetchMyAgents();
    }, [fetchMyAgents, onAgentCreated]);
    
    const handleVisibilityToggle = async (agent: Agent) => {
        if (!publicKey || !signMessage) return;

        const message = new TextEncoder().encode(`Toggle visibility for agent: ${agent.name}`);
        const signature = await signMessage(message);
        
        const response = await fetch(`/api/agents/${agent._id}/visibility`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                isPublic: !agent.isPublic,
                creatorWalletAddress: publicKey.toBase58(),
                signature: bs58.encode(signature),
                message: `Toggle visibility for agent: ${agent.name}`,
            }),
        });
        
        if (response.ok) {
            fetchMyAgents(); // Refresh list
        } else {
            const err = await response.json();
            useStore.getState().setError(`Failed to update visibility: ${err.error}`);
        }
    };

    const handleSelect = (agent: Agent) => {
        setActiveCustomAgent(agent);
        toggleCreateAgentModal(false);
    };

    if (!publicKey) {
        return <p className="tab-message">Connect your wallet to see your agents.</p>;
    }

    if (isLoading) {
        return <p className="tab-message">Loading your agents...</p>;
    }

    if (myAgents.length === 0) {
        return <p className="tab-message">You haven't created any agents yet.</p>;
    }

    return (
        <div className="your-agents-list">
            {myAgents.map(agent => (
                <div key={agent._id} className="agent-list-item">
                     <div className="agent-list-item-info">
                        <h5>{agent.name}</h5>
                        <a href={`https://solscan.io/token/${agent.nftDetails?.mintAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="nft-link">
                           View NFT <span className="icon small">open_in_new</span>
                        </a>
                    </div>
                    <div className="agent-list-metrics">
                        <div className="metric-item">
                            <span className="icon small">group</span> {agent.subscriptionCount || 0}
                        </div>
                         <div className="visibility-toggle">
                            <label htmlFor={`vis-${agent._id}`}>{agent.isPublic ? 'Public' : 'Private'}</label>
                            <label className="switch">
                                <input id={`vis-${agent._id}`} type="checkbox" checked={agent.isPublic} onChange={() => handleVisibilityToggle(agent)} />
                                <span className="slider round"></span>
                            </label>
                        </div>
                    </div>
                    <div className="agent-list-actions">
                        <button onClick={() => handleSelect(agent)} className="select-agent-btn" title="Select this Agent">
                            <span className="icon">play_circle</span>
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};

const animationFields = [
    { name: 'greeting', label: 'Greeting Animation URL', placeholder: 'URL to greeting.vrma' },
    { name: 'dance', label: 'Dance Animation URL', placeholder: 'URL to dance.vrma' },
    { name: 'spin', label: 'Spin Animation URL', placeholder: 'URL to spin.vrma' },
    { name: 'pose', label: 'Pose Animation URL', placeholder: 'URL to pose.vrma' },
    { name: 'pumped', label: 'Pumped Animation URL', placeholder: 'URL to pumped.vrma' },
];

export default function CreateAgentModal() {
    const { publicKey, signMessage } = useWallet();
    const [activeTab, setActiveTab] = useState<'create' | 'your_agents'>('create');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [systemInstruction, setSystemInstruction] = useState('');
    const [vrmUrl, setVrmUrl] = useState('');
    const [vrmAssetId, setVrmAssetId] = useState<string | null>(null);
    const [modelUploadStatus, setModelUploadStatus] = useState<'idle' | 'uploading' | 'uploaded' | 'error'>('idle');
    const [animationUrls, setAnimationUrls] = useState<Record<string, string>>({});
    const [isAdvancedOpen, setAdvancedOpen] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'signing' | 'creating'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [_agentCreated, setAgentCreated] = useState(0);

    const isSubmitting = submitStatus !== 'idle';
    const setCustomAgents = useStore.use.setCustomAgents();
    
    const handleAnimationUrlChange = (name: string, value: string) => {
        setAnimationUrls(prev => ({ ...prev, [name]: value }));
    };

    const getSubmitButtonText = () => {
        switch (submitStatus) {
            case 'signing':
                return 'Awaiting Signature...';
            case 'creating':
                return 'Minting Agent NFT...';
            default:
                return 'Sign & Create Agent';
        }
    };

    const uploadAsset = useCallback(async (file: File, type: 'model' | 'animation' | 'background') => {
        if (!publicKey || !signMessage) {
            throw new Error('Connect a wallet that supports message signing before uploading assets.');
        }

        const walletAddress = publicKey.toBase58();
        const messageStr = `Authorize ${type} upload ${file.name} at ${new Date().toISOString()}`;
        const signatureBytes = await signMessage(new TextEncoder().encode(messageStr));
        const signatureBase58 = bs58.encode(signatureBytes);

        const params = new URLSearchParams({
            type,
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            walletAddress,
            message: messageStr,
            signature: signatureBase58,
        });

        const response = await fetch(`/api/assets/upload?${params.toString()}`, {
            method: 'POST',
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
            },
            body: file,
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Asset upload failed');
        }

        return result as { assetId: string; downloadUrl: string };
    }, [publicKey, signMessage]);

    const handleVrmFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        if (file.size > 100 * 1024 * 1024) {
            setError('Model files must be under 100MB.');
            return;
        }
        if (!file.name.toLowerCase().endsWith('.vrm')) {
            setError('Please upload a .vrm file.');
            return;
        }

        try {
            setError(null);
            setModelUploadStatus('uploading');
            const { assetId, downloadUrl } = await uploadAsset(file, 'model');
            setVrmAssetId(assetId);
            setVrmUrl(downloadUrl);
            setModelUploadStatus('uploaded');
        } catch (uploadErr: any) {
            console.error('VRM upload failed', uploadErr);
            setError(uploadErr.message || 'Failed to upload model.');
            setModelUploadStatus('error');
        }
    }, [uploadAsset]);

    const resetForm = () => {
        setName('');
        setDescription('');
        setSystemInstruction('');
        setVrmUrl('');
        setVrmAssetId(null);
        setModelUploadStatus('idle');
        setAnimationUrls({});
        setAdvancedOpen(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        if (!publicKey || !signMessage) {
            setError("Please connect your wallet and ensure it supports message signing.");
            return;
        }
        if (!vrmUrl.trim()) {
            setError("A .vrm model URL or upload is required.");
            return;
        }
        
        setError(null);

        try {
            setSubmitStatus('signing');
            const message = new TextEncoder().encode("Sign this message to confirm ownership of your wallet for creating an AI Agent.");
            const signature = await signMessage(message);
            const signatureBase58 = bs58.encode(signature);

            setSubmitStatus('creating');
            const formData = new FormData();
            formData.append('name', name);
            formData.append('description', description);
            formData.append('systemInstruction', systemInstruction);
            formData.append('creatorWalletAddress', publicKey.toBase58());
            formData.append('signature', signatureBase58);
            formData.append('message', "Sign this message to confirm ownership of your wallet for creating an AI Agent.");
            if (vrmAssetId) {
                formData.append('vrmAssetId', vrmAssetId);
            }
            
            if (animationUrls.greeting) formData.append('animationGreetingUrl', animationUrls.greeting);
            if (animationUrls.dance) formData.append('animationDanceUrl', animationUrls.dance);
            if (animationUrls.spin) formData.append('animationSpinUrl', animationUrls.spin);
            if (animationUrls.pose) formData.append('animationPoseUrl', animationUrls.pose);
            if (animationUrls.pumped) formData.append('animationPumpedUrl', animationUrls.pumped);
            
            formData.append('vrmUrl', vrmUrl);

            const response = await fetch('/api/agents/create', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Failed to create agent.');
            }
            
            const allAgentsRes = await fetch('/api/agents/list');
            const allAgents = await allAgentsRes.json();
            setCustomAgents(allAgents);

            setActiveTab('your_agents');
            setAgentCreated(c => c + 1); // Trigger refresh in YourAgentsTab
            resetForm();

        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred.');
            console.error(err);
        } finally {
            setSubmitStatus('idle');
        }
    };
    
    return (
        <div className="modal-backdrop create-agent-modal" onClick={() => toggleCreateAgentModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="close-button" onClick={() => toggleCreateAgentModal(false)}>
                    <span className="icon">close</span>
                </button>
                <div className="tab-headers">
                    <button className={activeTab === 'create' ? 'active' : ''} onClick={() => setActiveTab('create')}>Create New Agent</button>
                    <button className={activeTab === 'your_agents' ? 'active' : ''} onClick={() => setActiveTab('your_agents')}>Your Agents</button>
                </div>

                {activeTab === 'create' ? (
                    <form onSubmit={handleSubmit}>
                         {!publicKey && (
                            <div className="wallet-connect-prompt">
                                <p>Connect your wallet to create an agent.</p>
                                <WalletMultiButton />
                            </div>
                        )}
                        <fieldset disabled={!publicKey || isSubmitting}>
                            <div className="form-instructions">
                                <h3>Become an aiDreams Creator!</h3>
                                <p>To make your agent unique, you need a <strong>.vrm model file</strong> hosted online. We recommend <a href="https://echo3d.com" target="_blank" rel="noopener noreferrer">echo3D</a> for easy public links. Alternatively, use a service like Google Drive, but ensure you create a <strong>direct download link</strong>.</p>
                                <p>Learn to create 3D characters <a href="https://pandako.itch.io/with-threejs-extension-for-gdevelop/devlog/998994/what-is-vrm-and-how-to-make-it" target="_blank" rel="noopener noreferrer">here</a>.</p>
                            </div>
                            <div className="form-group">
                                <label htmlFor="agent-name">Agent Name</label>
                                <input id="agent-name" type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g., Captain Pepe" />
                            </div>
                            <div className="form-group">
                                <label htmlFor="agent-desc">Short Description</label>
                                <input id="agent-desc" type="text" value={description} onChange={e => setDescription(e.target.value)} required placeholder="e.g., A degen space frog on a mission." />
                            </div>
                            <div className="form-group">
                                <label htmlFor="agent-instruction">Personality / System Instruction</label>
                                <textarea id="agent-instruction" value={systemInstruction} onChange={e => setSystemInstruction(e.target.value)} required placeholder="Describe your agent's persona, knowledge, and how it should behave." />
                            </div>
                             <div className="form-group">
                                <label htmlFor="agent-vrm-url">3D Model URL (.vrm)</label>
                                <input id="agent-vrm-url" type="url" value={vrmUrl} onChange={e => setVrmUrl(e.target.value)} required placeholder="https://example.com/model.vrm" />
                            </div>
                            <div className="form-group">
                                <label htmlFor="agent-vrm-file">Or upload 3D Model (.vrm)</label>
                                <input
                                    id="agent-vrm-file"
                                    type="file"
                                    accept=".vrm"
                                    onChange={handleVrmFileUpload}
                                    disabled={!publicKey || modelUploadStatus === 'uploading' || isSubmitting}
                                />
                                {modelUploadStatus === 'uploading' && <p className="upload-status">Uploading model to secure storage...</p>}
                                {modelUploadStatus === 'uploaded' && <p className="upload-status success">Model uploaded and linked from Backblaze.</p>}
                                {modelUploadStatus === 'error' && <p className="upload-status error">Model upload failed. Please try again.</p>}
                            </div>
                            <div className="form-group">
                                <button type="button" className="advanced-options-toggle" onClick={() => setAdvancedOpen(v => !v)}>
                                    Custom Animations (Optional)
                                    <span className="icon">{isAdvancedOpen ? 'expand_less' : 'expand_more'}</span>
                                </button>
                                {isAdvancedOpen && (
                                    <div className="advanced-options-content">
                                        <p>Provide direct public URLs to <code>.vrma</code> files for custom gestures.</p>
                                        {animationFields.map(field => (
                                            <div key={field.name} className="form-group-small">
                                                <label htmlFor={`anim-${field.name}`}>{field.label}</label>
                                                <input
                                                    id={`anim-${field.name}`}
                                                    type="url"
                                                    value={animationUrls[field.name] || ''}
                                                    onChange={e => handleAnimationUrlChange(field.name, e.target.value)}
                                                    placeholder={field.placeholder}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {error && <p className="error-message">{error}</p>}
                            <button type="submit" disabled={!publicKey || isSubmitting || modelUploadStatus === 'uploading'}>
                                {getSubmitButtonText()}
                            </button>
                        </fieldset>
                    </form>
                ) : (
                    <YourAgentsTab onAgentCreated={() => setAgentCreated(c => c+1)} />
                )}
            </div>
        </div>
    );
}