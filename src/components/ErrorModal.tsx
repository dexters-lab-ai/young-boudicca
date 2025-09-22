/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

interface ErrorModalProps {
    message: string;
    onClose: () => void;
}

export default function ErrorModal({ message, onClose }: ErrorModalProps) {
    return (
        <div className="error-modal-backdrop" onClick={onClose}>
            <div className="error-modal-content" onClick={e => e.stopPropagation()}>
                <div className="icon">error_outline</div>
                <h2 style={{ marginTop: 0, color: '#ff453a' }}>An Error Occurred</h2>
                <p style={{ color: '#f0f0f0', margin: '1rem 0' }}>{message}</p>
                <button 
                    onClick={onClose} 
                    style={{ 
                        padding: '10px 20px', 
                        background: '#ff453a', 
                        color: '#fff', 
                        border: 0, 
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontWeight: 'bold',
                    }}
                >
                    Close
                </button>
            </div>
        </div>
    );
}