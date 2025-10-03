/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useState } from 'react';
import { generateMeme } from '../lib/llm';
import { addMessage } from '../lib/actions';
import useStore from '../lib/store';
import '../styles/MemeGenerator.css';

type Props = { onClose?: () => void };

export default function MemeGenerator({ onClose }: Props) {
    const [prompt, setPrompt] = useState('');
    const [generatedUrl, setGeneratedUrl] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const setTempBackgroundUrl = useStore.use.setTempBackgroundUrl();

    const canvasSize = 1080;

    const renderMemePng = (text: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvasSize;
        canvas.height = canvasSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        // Background gradient
        const grad = ctx.createLinearGradient(0, 0, canvasSize, canvasSize);
        grad.addColorStop(0, '#141A1F');
        grad.addColorStop(1, '#1F2A33');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvasSize, canvasSize);

        // Draw subtle pattern
        ctx.globalAlpha = 0.08;
        for (let i = 0; i < 40; i++) {
            ctx.beginPath();
            ctx.arc(Math.random() * canvasSize, Math.random() * canvasSize, Math.random() * 40 + 10, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Caption text (stroke + fill)
        const padding = 64;
        const maxWidth = canvasSize - padding * 2;
        let fontSize = 64;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const wrapText = (t: string, size: number) => {
            ctx.font = `bold ${size}px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
            const words = t.split(/\s+/);
            const lines: string[] = [];
            let line = '';
            for (const w of words) {
                const test = line ? `${line} ${w}` : w;
                const width = ctx.measureText(test).width;
                if (width < maxWidth) {
                    line = test;
                } else {
                    if (line) lines.push(line);
                    line = w;
                }
            }
            if (line) lines.push(line);
            return lines;
        };

        // Adjust font size to fit in area
        let lines = wrapText(text, fontSize);
        while ((lines.length > 4 || Math.max(...lines.map(l => ctx.measureText(l).width)) > maxWidth) && fontSize > 28) {
            fontSize -= 4;
            lines = wrapText(text, fontSize);
        }
        ctx.font = `bold ${fontSize}px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial`;

        const totalHeight = lines.length * (fontSize * 1.25);
        let y = canvasSize - totalHeight - padding;
        const x = canvasSize / 2;

        // Draw container bar behind text for contrast
        const boxPadding = 24;
        const boxHeight = totalHeight + boxPadding * 2;
        const boxY = y - boxPadding;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(padding / 2, boxY, canvasSize - padding, boxHeight);

        for (const line of lines) {
            // Stroke
            ctx.lineWidth = Math.max(4, fontSize * 0.08);
            ctx.strokeStyle = 'black';
            ctx.strokeText(line, x, y);
            // Fill
            ctx.fillStyle = 'white';
            ctx.fillText(line, x, y);
            y += fontSize * 1.25;
        }

        // Small watermark
        ctx.font = `500 ${Math.floor(fontSize * 0.5)}px Inter, system-ui`;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.textAlign = 'left';
        ctx.fillText('Boudi AI', padding, padding + 12);

        return canvas.toDataURL('image/png');
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            addMessage("You need to tell me what kind of meme to make, ya daftie.", 'assistant');
            return;
        }
        setIsGenerating(true);
        setGeneratedUrl('');
        addMessage(`Right, forging a meme about "${prompt}"... Give me a sec.`, 'assistant');
        const result = await generateMeme(prompt);
        setIsGenerating(false);

        if (result) {
            const png = renderMemePng(result);
            setGeneratedUrl(png);
            setTempBackgroundUrl('/images/boudicca.png');
            addMessage("Behold! Your glorious meme. Share it with the world.", 'assistant');
        } else {
            addMessage("Couldn't generate the meme. The creative spirit has left me.", 'assistant');
        }
    };

    const handleDownload = () => {
        if (!generatedUrl) return;
        const a = document.createElement('a');
        a.href = generatedUrl;
        a.download = 'boudi-ai-meme.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleShare = () => {
        const tweetText = `Check out this meme I made with Boudi AI! #BoudiAI #CryptoRebellion`;
        const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
        window.open(tweetUrl, '_blank');
    };

    const handleClose = () => {
        setGeneratedUrl('');
        setTempBackgroundUrl(null);
        onClose?.();
    };

    return (
        <div className="meme-generator-container">
            {isGenerating && <div className="media-overlay shimmer">Forging Meme...</div>}
            
            {generatedUrl && !isGenerating && (
                <>
                    <img src={generatedUrl} alt="Generated Meme" />
                    <div className="download-button-container">
                        <button className="download-button" onClick={handleDownload}>Download</button>
                        <button className="download-button" onClick={handleClose}>Close</button>
                        <button className="download-button" onClick={handleShare}>Share on X</button>
                    </div>
                </>
            )}
            
            {!generatedUrl && !isGenerating && (
                <div className="meme-prompt-ui">
                    <h2>Meme Generator</h2>
                    <p>Tell me your vision. What rebellious crypto meme shall we forge today?</p>
                    <div className="chat-input-area">
                         <input
                            type="text"
                            placeholder="e.g., Bitcoin charging against fiat Romans"
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                        />
                        <button onClick={handleGenerate} disabled={isGenerating}>
                            <span className="icon">auto_awesome</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}