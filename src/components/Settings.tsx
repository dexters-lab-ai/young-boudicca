/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useState } from 'react';
import useStore from '../lib/store';
import { setApiKey, toggleSettingsModal } from '../lib/actions';

export default function Settings() {
    const currentApiKey = useStore.use.apiKey();
    const currentRealtimeModel = useStore.use.realtimeModel();
    const setRealtimeModel = useStore.use.setRealtimeModel();

    const [key, setKey] = useState(currentApiKey || '');
    const [realtimeModel, setRtModel] = useState<string>(currentRealtimeModel);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setApiKey(key.trim());
        setRealtimeModel(realtimeModel.trim() || 'gemini-2.5-flash');
        toggleSettingsModal(false);
    };

    return (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <form onSubmit={handleSubmit} style={{ background: '#111', color: '#fff', padding: 16, borderRadius: 8, width: 420, maxWidth: '90vw' }}>
                <h2 style={{ marginTop: 0 }}>Settings</h2>
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
                <label style={{ display: 'block', marginBottom: 8 }}>
                    Realtime Model
                    <input
                        type="text"
                        placeholder="gemini-2.5-flash"
                        value={realtimeModel}
                        onChange={(e) => setRtModel(e.target.value)}
                        style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 4, border: '1px solid #333', background: '#222', color: '#fff' }}
                    />
                </label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '16px' }}>
                    <button type="button" onClick={() => toggleSettingsModal(false)} style={{ padding: '8px 12px', background: '#333', color: '#fff', border: 0, borderRadius: 4 }}>Close</button>
                    <button type="submit" style={{ padding: '8px 12px', background: '#4caf50', color: '#fff', border: 0, borderRadius: 4 }}>Save</button>
                </div>
            </form>
        </div>
    );
}