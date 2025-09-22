/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useState } from 'react';
import { setApiKey, toggleWelcomeModal } from '../lib/actions';

export default function Welcome() {
    const [key, setKey] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setApiKey(key.trim());
        toggleWelcomeModal(false);
    };

    const skip = () => toggleWelcomeModal(false);

    return (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <form onSubmit={handleSubmit} style={{ background: '#111', color: '#fff', padding: 16, borderRadius: 8, width: 420, maxWidth: '90vw' }}>
                <h2 style={{ marginTop: 0 }}>Welcome</h2>
                <p style={{ marginTop: 0 }}>Enter your Google API key to enable text and image generation. You can change this later in Settings.</p>
                <label style={{ display: 'block', marginBottom: 8 }}>
                    API Key
                    <input
                        type="password"
                        placeholder="Enter your Google API key"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 4, border: '1px solid #333', background: '#222', color: '#fff' }}
                    />
                </label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={skip} style={{ padding: '8px 12px', background: '#333', color: '#fff', border: 0, borderRadius: 4 }}>Skip</button>
                    <button type="submit" style={{ padding: '8px 12px', background: '#4caf50', color: '#fff', border: 0, borderRadius: 4 }}>Save</button>
                </div>
            </form>
        </div>
    );
}