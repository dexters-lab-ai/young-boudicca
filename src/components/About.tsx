/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { toggleAboutModal } from '../lib/actions';

export default function About() {
    return (
        <div className="modal-backdrop about-modal" onClick={() => toggleAboutModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="close-button" onClick={() => toggleAboutModal(false)}>
                    <span className="icon">close</span>
                </button>
                <div className="about-header">
                    <img src="/images/frankenstein-icon.png" alt="aiDreams AI Icon" />
                    <h1>About 🌙 aiDreams</h1>
                    <p>Bring Your Creations to Life</p>
                </div>

                <div className="about-content-wrapper">
                    <div className="about-grid">
                        <div className="about-column">
                            <h3>The Inspiration</h3>
                            <p>
                                Our story started with the idea of bringing characters to life. What if you could build an army of unique, intelligent beings? This project is a digital launchpad for creators to build and own their virtual companions.
                            </p>

                            <h3>The Vision: Personified AI</h3>
                            <p>
                                We are moving past simple data agents. The next frontier is the meta of virtual 3D agents and the worlds they inhabit. It's about creating AI with a face, a story, and a personality you can connect with—and even own on the blockchain.
                            </p>
                            <video
                                className="about-video"
                                src="/videos/model-demo-1.mp4"
                                autoPlay
                                loop
                                muted
                                playsInline
                            />
                        </div>
                        <div className="about-column">
                            <h3>Key Features</h3>
                            <ul className="key-features-list">
                                <li className="feature-item">
                                    <span className="icon">voice_chat</span>
                                    <div>
                                        <h5>Real-time Voice Chat</h5>
                                        <p>Natural, low-latency conversations.</p>
                                    </div>
                                </li>
                                <li className="feature-item">
                                    <span className="icon">smart_toy</span>
                                    <div>
                                        <h5>Dynamic 3D Avatars</h5>
                                        <p>Expressive models with lip-sync and gestures.</p>
                                    </div>
                                </li>
                                <li className="feature-item">
                                    <span className="icon">share</span>
                                    <div>
                                        <h5>NFT Agent Creation</h5>
                                        <p>Design, mint, and share your own unique AI agents.</p>
                                    </div>
                                </li>
                                <li className="feature-item">
                                    <span className="icon">query_stats</span>
                                    <div>
                                        <h5>Live On-Chain Toolkit</h5>
                                        <p>Access Solana data and betting markets via Function Calling.</p>
                                    </div>
                                </li>
                            </ul>

                            <h3>The Tech Stack</h3>
                            <p>
                            This app is built with React, Three.js, and Google's Gemini, using a Node.js server to securely orchestrate AI services like ElevenLabs for voice and Solscan for live blockchain data, with Solana for NFTs.
                            </p>
                            <video
                                className="about-video"
                                src="/videos/model-demo-2.mp4"
                                autoPlay
                                loop
                                muted
                                playsInline
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}