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
                <div style={{ textAlign: 'center', marginBottom: '1.5rem', flexShrink: 0 }}>
                    <img src="/images/boudicca.png" alt="Boudi AI Icon" style={{ width: '80px', height: '80px', margin: '0 auto', borderRadius: '50%', border: '2px solid #333' }} />
                    <h1 style={{ fontSize: '1.8rem', marginTop: '1rem', marginBottom: '0.25rem' }}>About Young Boudicca</h1>
                    <p style={{ color: '#a0a0a0', fontSize: '0.9rem' }}>The Warrior Queen of the Digital Age</p>
                </div>

                <div style={{ flex: '1', minHeight: 0, overflowY: 'auto', paddingRight: '1rem', fontSize: '0.9rem', lineHeight: '1.6' }}>
                    <h3 style={{ color: '#005EB8' }}>The Inspiration</h3>
                    <p>
                        Our story started with a viral video of Young Boudicca, the fierce Scottish warrior girl who defended her sister. We thought, what if you could actually talk to her? What if you could ally with that spirit of rebellion? That single idea sparked this project. We wanted to bring a character, a meme, to life.
                        <a href="https://x.com/i/trending/1960387136936710397" target="_blank" rel="noopener noreferrer" style={{ color: '#005EB8', textDecoration: 'underline', marginLeft: '5px' }}>
                            See the legend.
                        </a>
                    </p>

                    <h3 style={{ color: '#005EB8', marginTop: '1.5rem' }}>The New Meta: Virtual Beings</h3>
                    <p>
                        We are moving past the era of simple data agents and trading bots. The next frontier is the meta of virtual 3D agents and the worlds they inhabit. It's about creating AI with a face, a story, and a personality you can connect with. Why can't everyone bring their favorite character or meme to life?
                    </p>
                    <video
                        className="about-video"
                        src="/videos/model-demo-1.mp4"
                        autoPlay
                        loop
                        muted
                        playsInline
                        controls
                        width="100%"
                    />

                    <h3 style={{ color: '#005EB8', marginTop: '1.5rem' }}>The Tech</h3>
                    <p style={{ fontStyle: 'italic', color: '#ccc' }}>
                        Our character architecture is inspired by the digital personality systems seen in platforms like VRChat and pioneering work like the 'Project Airi' repository. We've adapted that foundation, empowering our virtual beings with a suite of live, on-chain crypto tools and advanced conversational abilities through Google's Gemini. This isn't just a chatbot; it's an interactive ally, ready for the digital rebellion.
                    </p>
                    <video
                        className="about-video"
                        src="/videos/model-demo-2.mp4"
                        autoPlay
                        loop
                        muted
                        playsInline
                        controls
                        width="100%"
                    />
                </div>

                <button
                    onClick={() => toggleAboutModal(false)}
                    style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '8px',
                        background: '#005EB8',
                        color: 'white',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        marginTop: '1.5rem',
                        flexShrink: 0,
                    }}
                >
                    Close
                </button>
            </div>
        </div>
    );
}