import React, { useState, useRef, useEffect, useCallback } from 'react';
import useStore from '../lib/store';
import { toggleCreateAgentModal, setActiveCustomAgent } from '../lib/actions';
import { Agent } from '../types';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import bs58 from 'bs58';

const YourAgentsTab: React.FC = () => {
    const { publicKey } = useWallet();
    const [myAgents, setMyAgents] = useState<Agent[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchMyAgents = useCallback(() => {
        if (publicKey) {
            setIsLoading(true);
            fetch(`/api/agents/creator/${publicKey.toBase58()}`)
                .then(res => res.json())
                .then(data => {
                    setMyAgents(data);
                })
                .catch(err => {
                    console.error("Failed to fetch user's agents", err);
                })
                .finally(() => {
                    setIsLoading(false);
                });
        }
    }, [publicKey]);

    useEffect(() => {
        fetchMyAgents();
    }, [fetchMyAgents]);

    const handleTweet = (agent: Agent) => {
        const text = `I just created an AI Agent "${agent.name}" on Boudi AI! Come chat with it. #BoudiAI`;
        const appUrl = window.location.origin;
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(appUrl)}`;
        window.open(url, '_blank');
    };

    const handleSelect = (agent: Agent) => {
        setActiveCustomAgent(agent);
        toggleCreateAgentModal(false);
    };

    if (!publicKey) {
        return <p style={{textAlign: 'center', color: '#a0a0a0', padding: '2rem'}}>Connect your wallet to see your agents.</p>;
    }

    if (isLoading) {
        return <p style={{textAlign: 'center', color: '#a0a0a0', padding: '2rem'}}>Loading your agents...</p>;
    }

    if (myAgents.length === 0) {
        return <p style={{textAlign: 'center', color: '#a0a0a0', padding: '2rem'}}>You haven't created any agents yet.</p>;
    }

    return (
        <div className="your-agents-list">
            {myAgents.map(agent => (
                <div key={agent._id} className="agent-list-item">
                    <img src={agent.vrmUrl.startsWith('http') ? agent.vrmUrl : "/images/boudicca.png"} alt={agent.name} style={{width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover'}} onError={(e) => { e.currentTarget.src = "/images/boudicca.png" }} />
                    <div className="agent-list-item-info">
                        <h5>{agent.name}</h5>
                        <p>{agent.description}</p>
                    </div>
                    <div className="agent-list-actions">
                        <button onClick={() => handleSelect(agent)} className="select-agent-btn" title="Select this Agent">
                            <span className="icon">play_circle</span>
                        </button>
                        <button onClick={() => handleTweet(agent)} className="tweet-btn" title="Share on X">
                            <span className="icon">share</span>
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
    const [vrmFile, setVrmFile] = useState<File | null>(null);
    const [vrmUrl, setVrmUrl] = useState('');
    const [inputType, setInputType] = useState<'upload' | 'url'>('upload');
    const [animationUrls, setAnimationUrls] = useState<Record<string, string>>({});
    const [isAdvancedOpen, setAdvancedOpen] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'signing' | 'uploading' | 'creating'>('idle');
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isSubmitting = submitStatus !== 'idle';
    const setCustomAgents = useStore.use.setCustomAgents();
    
    const handleAnimationUrlChange = (name: string, value: string) => {
        setAnimationUrls(prev => ({ ...prev, [name]: value }));
    };

    const getSubmitButtonText = () => {
        switch (submitStatus) {
            case 'signing': return 'Awaiting Signature...';
            case 'uploading': return 'Uploading Model...';
            case 'creating': return 'Creating Agent...';
            default: return 'Sign & Create Agent';
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!publicKey || !signMessage) {
            setError("Please connect your wallet and ensure it supports message signing.");
            return;
        }
        if (inputType === 'upload' && !vrmFile) {
            setError("A .vrm model file is required.");
            return;
        }
        if (inputType === 'url' && !vrmUrl.trim()) {
            setError("A .vrm model URL is required.");
            return;
        }
        
        setError(null);

        try {
            // 1. Sign a message to prove ownership
            setSubmitStatus('signing');
            const message = new TextEncoder().encode("Sign this message to confirm ownership of your wallet for creating an AI Agent.");
            const signature = await signMessage(message);
            const signatureBase58 = bs58.encode(signature);

            // 2. Prepare form data
            setSubmitStatus('uploading');
            const formData = new FormData();
            formData.append('name', name);
            formData.append('description', description);
            formData.append('systemInstruction', systemInstruction);
            formData.append('creatorWalletAddress', publicKey.toBase58());
            formData.append('signature', signatureBase58);
            formData.append('message', "Sign this message to confirm ownership of your wallet for creating an AI Agent.");
            
            // Append animation URLs
            if (animationUrls.greeting) formData.append('animationGreetingUrl', animationUrls.greeting);
            if (animationUrls.dance) formData.append('animationDanceUrl', animationUrls.dance);
            if (animationUrls.spin) formData.append('animationSpinUrl', animationUrls.spin);
            if (animationUrls.pose) formData.append('animationPoseUrl', animationUrls.pose);
            if (animationUrls.pumped) formData.append('animationPumpedUrl', animationUrls.pumped);


            if (inputType === 'upload' && vrmFile) {
                formData.append('vrmFile', vrmFile);
            } else if (inputType === 'url' && vrmUrl) {
                formData.append('vrmUrl', vrmUrl);
            }

            setSubmitStatus('creating');
            const response = await fetch('/api/agents/create', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Failed to create agent.');
            }
            
            const newAgent = result;
            
            // Refresh the main agent list
            const allAgentsRes = await fetch('/api/agents/list');
            const allAgents = await allAgentsRes.json();
            setCustomAgents(allAgents);

            // Switch to "Your Agents" and select the new one
            setActiveTab('your_agents');
            setActiveCustomAgent(newAgent);
            toggleCreateAgentModal(false);

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
                            <div style={{ textAlign: 'center', padding: '1rem', background: 'var(--background-dark)', borderRadius: '8px', marginBottom: '1rem' }}>
                                <p style={{margin: 0, color: 'var(--text-secondary)'}}>Connect your wallet to create an agent.</p>
                                <div style={{marginTop: '1rem'}}>
                                  <WalletMultiButton />
                                </div>
                            </div>
                        )}
                        <fieldset disabled={!publicKey || isSubmitting} style={{border: 'none', padding: 0, margin: 0}}>
                            <p style={{fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '1.5rem'}}>Design a new AI personality. Give it a name, a mission, and a unique 3D model. Once created, it will be discoverable by everyone.</p>
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
                                <label>3D Model (.vrm file)</label>
                                <div className="input-type-switch">
                                    <button type="button" className={inputType === 'upload' ? 'active' : ''} onClick={() => setInputType('upload')}>Upload File</button>
                                    <button type="button" className={inputType === 'url' ? 'active' : ''} onClick={() => setInputType('url')}>From URL</button>
                                </div>
                                {inputType === 'upload' ? (
                                    <>
                                        <input type="file" accept=".vrm" onChange={e => setVrmFile(e.target.files?.[0] || null)} ref={fileInputRef} style={{display: 'none'}} required={inputType === 'upload'}/>
                                        <button type="button" className="file-upload-label" onClick={() => fileInputRef.current?.click()}>
                                            {vrmFile ? vrmFile.name : 'Click to upload VRM model'}
                                        </button>
                                    </>
                                ) : (
                                    <input id="agent-vrm-url" type="url" value={vrmUrl} onChange={e => setVrmUrl(e.target.value)} required={inputType === 'url'} placeholder="https://example.com/model.vrm" />
                                )}
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
                            {error && <p style={{color: '#ff453a', textAlign: 'center', fontSize: '0.9rem'}}>{error}</p>}
                            <button type="submit" disabled={!publicKey || isSubmitting} style={{marginTop: '1rem'}}>
                                {getSubmitButtonText()}
                            </button>
                        </fieldset>
                    </form>
                ) : (
                    <YourAgentsTab />
                )}
            </div>
        </div>
    );
}