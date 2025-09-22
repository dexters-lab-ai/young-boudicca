/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {createRoot} from 'react-dom/client'
import App from './src/components/App.tsx'

// --- Setup for background glitch effect ---
// This script runs once to create the elements for the CSS animation.
const gridContainer = document.getElementById('background');
if (gridContainer) {
    const numBoxes = 30; // Number of glitching cells
    for (let i = 0; i < numBoxes; i++) {
        const box = document.createElement('span');
        box.className = 'glitch-box';
        // Randomize position, delay, and duration for a natural, chaotic effect
        box.style.top = `${Math.random() * 100}%`;
        box.style.left = `${Math.random() * 100}%`;
        box.style.animationDelay = `${Math.random() * 8}s`;
        box.style.animationDuration = `${Math.random() * 5 + 5}s`;
        gridContainer.appendChild(box);
    }
}
// --- End of setup script ---

const container = document.getElementById('root') as HTMLElement | null;
if (!container) {
  throw new Error('Root container #root not found');
}
createRoot(container).render(<App />)