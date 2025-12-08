export class ScoreState {
    constructor() {
        this.listeners = [];
        this.clipboard = null;
        this.reset();
    }

    reset() {
        this.data = {
            tempo: 120,
            timeSignature: "4/4",
            clef: "treble",
            selectedIndex: -1,
            // Notes are stored as a flat list for this simple MVP. 
            // VexFlow formatting will handle measure breaks.
            notes: [
                // Initial empty rest or starting note if desired
            ]
        };
        this.notify();
    }

    subscribe(callback) {
        this.listeners.push(callback);
    }

    notify() {
        this.listeners.forEach(cb => cb(this.data));
    }

    // Add a note to the end
    addNote(noteName, duration, isRest = false) {
        // noteName example: "c/4", "f#/5"
        this.data.notes.push({
            keys: [noteName],
            duration: duration + (isRest ? "r" : ""),
            isRest: isRest
        });
        this.data.selectedIndex = -1;
        this.notify();
    }

    setTimeSignature(ts) {
        if (this.data.timeSignature !== ts) {
            this.data.timeSignature = ts;
            this.notify();
        }
    }

    setTempo(bpm) {
        const val = parseInt(bpm);
        if (this.data.tempo !== val && !isNaN(val)) {
            this.data.tempo = val;
            this.notify();
        }
    }

    addPitchToLastNote(noteName) {
        const notes = this.data.notes;
        if (notes.length === 0) return;
        const lastNote = notes[notes.length - 1];
        if (lastNote.isRest) return; // Can't add pitch to rest

        // Avoid duplicates
        if (!lastNote.keys.includes(noteName)) {
            lastNote.keys.push(noteName);
            // Sort keys to ensure correct VexFlow rendering (Low to High)
            lastNote.keys.sort((a, b) => this._compareNotes(a, b));
            this.notify();
        }
    }

    copySelectedNote() {
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < this.data.notes.length) {
            this.clipboard = JSON.parse(JSON.stringify(this.data.notes[idx]));
        }
    }

    pasteNote() {
        if (!this.clipboard) return;

        // Clone clipboard data
        const newNote = JSON.parse(JSON.stringify(this.clipboard));

        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < this.data.notes.length) {
            // Insert after selected
            this.data.notes.splice(idx + 1, 0, newNote);
            this.data.selectedIndex = idx + 1;
        } else {
            // Append to end
            this.data.notes.push(newNote);
            this.data.selectedIndex = this.data.notes.length - 1;
        }
        this.notify();
    }

    _compareNotes(a, b) {
        // Helper to sort notes like c/4, c#/4, d/4, c/5
        const parse = (n) => {
            const [key, oct] = n.split('/');
            const octave = parseInt(oct);
            const notes = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
            const keyBase = key.replace('#', '').replace('b', '').toLowerCase();
            const index = notes.indexOf(keyBase);
            return octave * 100 + index;
        };
        return parse(a) - parse(b);
    }

    deleteLastNote() {
        if (this.data.notes.length > 0) {
            this.data.notes.pop();
            this.data.selectedIndex = -1;
            this.notify();
        }
    }

    deleteSelectedNote() {
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < this.data.notes.length) {
            this.data.notes.splice(idx, 1);
            this.data.selectedIndex = -1;
            this.notify();
        } else {
            this.deleteLastNote();
        }
    }

    selectNote(index) {
        this.data.selectedIndex = index;
        this.notify();
    }

    getScore() {
        return this.data;
    }
}