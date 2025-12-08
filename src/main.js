import { ScoreState } from './state.js';
import { ScoreRenderer } from './renderer.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
    // 0. Initialize WebsimSocket
    const room = new WebsimSocket();

    // 1. Initialize State
    const state = new ScoreState();

    // 2. Initialize Audio
    const audio = new AudioEngine();

    // 3. Initialize Renderer
    const renderer = new ScoreRenderer('canvas-wrapper');
    renderer.init();

    // 4. Initialize UI
    const ui = new UI(state, audio, renderer, room);

    // 5. Wire up subscriptions
    state.subscribe((data) => {
        renderer.render(data);
        ui.update(data);
        audio.setInstrument(data.instrument || 'piano');
        
        // Save to localstorage
        localStorage.setItem('litescore_data', JSON.stringify(data));
    });

    // 6. Load previous session
    const saved = localStorage.getItem('litescore_data');
    let loaded = false;
    if (saved) {
        try {
            loaded = state.loadData(JSON.parse(saved));
        } catch(e) {
            console.error("Failed to load save", e);
        }
    }
    
    if (!loaded) {
        // Initial Render
        renderer.render(state.getScore());
    }
    
    // Prevent zoom gestures on mobile
    document.addEventListener('gesturestart', function(e) {
        e.preventDefault();
    });

    // Handle Window Resize (Responsive Layout)
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            renderer.render(state.getScore());
        }, 150);
    });
}); 