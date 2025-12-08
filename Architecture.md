# Architecture

## Overview
This application is a lightweight, mobile-first music notation editor running entirely in the browser. It follows a modular architecture separating state management, rendering, audio synthesis, and user interaction.

## Tech Stack
- **Language**: Vanilla JavaScript (ES Modules).
- **Rendering**: [VexFlow](https://github.com/0xfe/vexflow) (via HTML5 Canvas).
- **Audio**: Web Audio API (Native).
- **Styling**: CSS3 (Flexbox/Grid for mobile responsiveness).
- **Storage**: LocalStorage (for auto-saving work).

## Modules

### 1. State Management (`src/state.js`)
- Holds the single source of truth for the musical score.
- Implements a **History Stack** (Undo/Redo) by snapshotting state on mutations.
- Structure:
  ```json
  {
    "tempo": 120, 
    "clef": "treble", 
    "timeSignature": "4/4", 
    "keySignature": "C",
    "notes": [
      { 
        "keys": ["c/4"], 
        "duration": "q", 
        "isRest": false,
        "isTied": false, 
        "isSlurred": false,
        "isTriplet": false
      }
    ]
  }
