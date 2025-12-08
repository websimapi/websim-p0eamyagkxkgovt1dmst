export class ScoreState {
    constructor() {
        this.listeners = [];
        this.clipboard = null;
        this.activeStaff = 'treble'; // 'treble' or 'bass'
        
        // History Management
        this.history = [];
        this.historyIndex = -1;
        this.MAX_HISTORY = 50;

        this.reset();
    }

    reset() {
        this.data = {
            id: null, // Database ID
            name: "Untitled Score",
            tempo: 120,
            timeSignature: "4/4",
            keySignature: "C",
            clef: "treble",
            clefBass: "bass", // New: Per-stave clef
            instrument: "guitar",
            baseFrequency: 440,
            tuningSystem: "et", // "et", "just", "pyth", "mean", "werck"
            barsPerSystem: 0, // 0 = Auto
            singleLine: false, // New setting
            showHeaders: true, // Show Clef/Key on every system
            showNoteNames: false,
            selectedIndex: -1,
            selectionEndIndex: -1, // For range selection
            selectionType: 'note', // 'note', 'tie', 'slur', 'hairpin', 'clef'
            // Notes are stored as a flat list for this simple MVP. 
            // VexFlow formatting will handle measure breaks.
            notes: [], // Treble staff (Legacy name kept for compat)
            notesBass: [], // Bass staff
            voices: [], // Polyphony support - multiple voices per staff
            hairpins: [], // { start: index, end: index, type: 'cresc'|'decresc', staff: 'treble'|'bass' }
            
            // Polyphony / Voices
            activeVoiceId: null, // null = base voice 1, else id of extra voice in voices[]
            
            // Playback Settings
            fermataScale: 2.0,
            
            // UI Settings (Persistent)
            ui: {
                showPiano: true,
                showDurationControls: true,
                showDynamicsControls: true,
                showEditTools: true
            }
        };
        // Reset history on hard reset
        this.history = [];
        this.historyIndex = -1;
        this._pushHistory(); // Initial state
        this.notify();
    }

    loadData(newData) {
        // Basic validation
        if (!newData || !Array.isArray(newData.notes)) {
            console.error("Invalid save data format");
            return false;
        }

        // Apply defaults for properties that might be missing in older saves
        this.data = {
            tempo: newData.tempo || 120,
            timeSignature: newData.timeSignature || "4/4",
            keySignature: newData.keySignature || "C",
            clef: newData.clef || "treble",
            clefBass: newData.clefBass || "bass",
            instrument: newData.instrument || "guitar",
            baseFrequency: newData.baseFrequency || 440,
            tuningSystem: newData.tuningSystem || "et",
            barsPerSystem: newData.barsPerSystem || 0,
            singleLine: newData.singleLine || false,
            showHeaders: newData.showHeaders !== undefined ? newData.showHeaders : true,
            showNoteNames: newData.showNoteNames || false,
            selectedIndex: -1,
            selectionEndIndex: -1,
            selectionType: 'note',
            selectionVoiceId: null,
            notes: newData.notes,
            notesBass: Array.isArray(newData.notesBass) ? newData.notesBass : [],
            hairpins: Array.isArray(newData.hairpins) ? newData.hairpins : [],
            // Ensure voices is always an array, even for older saves
            voices: Array.isArray(newData.voices) ? newData.voices : [],
            activeVoiceId: newData.activeVoiceId !== undefined ? newData.activeVoiceId : null
        };

        // Restore Metadata
        if (newData.id) this.data.id = newData.id;
        if (newData.name) this.data.name = newData.name;
        if (newData.tuningSystem) this.data.tuningSystem = newData.tuningSystem;
        if (newData.fermataScale) this.data.fermataScale = newData.fermataScale;
        if (newData.ui) this.data.ui = { ...this.data.ui, ...newData.ui };

        // Reset history for the new project
        this.history = [];
        this.historyIndex = -1;
        this._pushHistory();
        
        this.notify();
        return true;
    }

    // --- History Methods ---

    _pushHistory() {
        // If we are in the middle of history and modify, discard future
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }

        // Push copy
        this.history.push(JSON.stringify(this.data));
        this.historyIndex++;

        // Limit size
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
            this.historyIndex--;
        }
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.data = JSON.parse(this.history[this.historyIndex]);
            this.notify();
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.data = JSON.parse(this.history[this.historyIndex]);
            this.notify();
        }
    }

    setFermataScale(val) {
        const n = parseFloat(val);
        if (!isNaN(n) && this.data.fermataScale !== n) {
            this._pushHistory();
            this.data.fermataScale = n;
            this.notify();
        }
    }

    setUISetting(key, value) {
        if (this.data.ui[key] !== value) {
            // UI changes usually don't need undo history, but let's be safe or skip history
            this.data.ui[key] = value;
            this.notify();
        }
    }
    
    toggleFermata() {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            // Remove the isRest check to allow fermata on rests
            note.isFermata = !note.isFermata;
            this.notify();
        }
    }

    // --- Mutators (Wrapped with history saving) ---

    subscribe(callback) {
        this.listeners.push(callback);
    }

    notify() {
        // Inject activeStaff into the data object passed to views
        const payload = { ...this.data, activeStaff: this.activeStaff };
        this.listeners.forEach(cb => cb(payload));
    }

    setActiveStaff(staff) {
        if (this.activeStaff !== staff) {
            this.activeStaff = staff;
            // Clear selection when switching staves to avoid confusion
            // Unless we are just clicking the clef of the other staff
            if (this.data.selectionType !== 'clef') {
                this.data.selectedIndex = -1;
                this.data.selectionEndIndex = -1;
            }
            this.notify();
        }
    }

    _getActiveNotes() {
        return this.activeStaff === 'bass' ? this.data.notesBass : this.data.notes;
    }

    // Add a note
    addNote(noteName, duration, options = {}) {
        this._pushHistory();
        // Handle legacy call signature if necessary, though we updated UI
        const isRest = typeof options === 'boolean' ? options : (options.isRest || false);
        const isTriplet = typeof options === 'object' ? (options.isTriplet || false) : false;

        // noteName example: "c/4", "f#/5"
        const finalNote = isRest ? noteName : this._getBestSpelling(noteName);
        
        const newNote = {
            keys: [finalNote],
            duration: duration + (isRest ? "r" : ""),
            isRest: isRest,
            isTriplet: isTriplet
        };

        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;

        if (idx !== -1 && idx < targetNotes.length && this.data.selectionVoiceId == null) {
            // Insert AFTER selection on base voice only
            targetNotes.splice(idx + 1, 0, newNote);
            this._adjustHairpinIndices(idx + 1, 1); // Shift hairpins
            // Move selection to new note (Step Entry)
            this.data.selectedIndex = idx + 1;
            this.data.selectionEndIndex = idx + 1;
        } else {
            // Append to end
            targetNotes.push(newNote);
            // Select the newly added note
            this.data.selectedIndex = targetNotes.length - 1;
            this.data.selectionEndIndex = targetNotes.length - 1;
        }
        
        // New note is always on base voice
        this.data.selectionVoiceId = null;
        this.data.selectionType = 'note';
        this.notify();
    }

    setTimeSignature(ts) {
        if (this.data.timeSignature !== ts) {
            this._pushHistory();
            this.data.timeSignature = ts;
            this.notify();
        }
    }

    setTempo(bpm) {
        const val = parseInt(bpm);
        if (this.data.tempo !== val && !isNaN(val)) {
            this._pushHistory();
            this.data.tempo = val;
            this.notify();
        }
    }

    setKeySignature(key) {
        if (this.data.keySignature !== key) {
            this._pushHistory();
            this.data.keySignature = key;
            this.notify();
        }
    }

    setClef(clef) {
        // Set clef for the currently active staff (or selected clef)
        const targetProp = this.activeStaff === 'bass' ? 'clefBass' : 'clef';
        const oldClef = this.data[targetProp];
        
        if (oldClef !== clef) {
            this._pushHistory();
            this.data[targetProp] = clef;
            
            // Auto-transpose notes to match clef registers
            const notes = this.activeStaff === 'bass' ? this.data.notesBass : this.data.notes;
            this._transposeNotesToClef(notes, oldClef, clef);
            
            this.notify();
        }
    }

    _transposeNotesToClef(notes, oldClef, newClef) {
        // Approximate center octaves for clefs
        const centers = {
            'treble': 4,
            'bass': 2,
            'alto': 3,
            'tenor': 3,
            'percussion': 4 // No transpose usually, but let's keep it safe
        };
        
        const oldC = centers[oldClef] || 4;
        const newC = centers[newClef] || 4;
        const octaveShift = newC - oldC;
        
        if (octaveShift === 0) return;
        
        const semitones = octaveShift * 12;
        
        notes.forEach(note => {
            if (!note.isRest) {
                note.keys = note.keys.map(k => this._transposeKey(k, semitones));
            }
        });
    }

    setInstrument(inst) {
        if (this.data.instrument !== inst) {
            this._pushHistory();
            this.data.instrument = inst;
            this.notify();
        }
    }

    setBaseFrequency(freq) {
        const val = parseInt(freq);
        if (this.data.baseFrequency !== val && !isNaN(val)) {
            this._pushHistory();
            this.data.baseFrequency = val;
            this.notify();
        }
    }

    setTuningSystem(sys) {
        if (this.data.tuningSystem !== sys) {
            this._pushHistory();
            this.data.tuningSystem = sys;
            this.notify();
        }
    }

    toggleStaccato() {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            if (note.isRest) return;
            note.isStaccato = !note.isStaccato;
            this.notify();
        }
    }

    toggleAccent() {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            if (note.isRest) return;
            note.isAccent = !note.isAccent;
            this.notify();
        }
    }

    toggleMarcato() {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            if (note.isRest) return;
            note.isMarcato = !note.isMarcato;
            this.notify();
        }
    }

    toggleTenuto() {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            if (note.isRest) return;
            note.isTenuto = !note.isTenuto;
            this.notify();
        }
    }

    setDynamic(dynamic) {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            if (!note.isRest) {
                // Toggle off if same
                if (note.dynamic === dynamic) {
                    delete note.dynamic;
                } else {
                    note.dynamic = dynamic;
                }
                this.notify();
            }
        }
    }

    setLyric(text) {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            if (!note.isRest) {
                if (!text) {
                    delete note.lyric;
                } else {
                    note.lyric = text;
                }
                this.notify();
            }
        }
    }

    setBarsPerSystem(num) {
        const n = parseInt(num);
        if (this.data.barsPerSystem !== n && !isNaN(n)) {
            // Display setting, maybe strictly shouldn't be undoable history? 
            // Users usually expect layout changes to be persistent but not necessarily "undoable" musical changes.
            // But let's keep it simple.
            this.data.barsPerSystem = n;
            this.notify();
        }
    }

    setSingleLine(val) {
        if (this.data.singleLine !== val) {
            this.data.singleLine = val;
            this.notify();
        }
    }

    setShowHeaders(val) {
        if (this.data.showHeaders !== val) {
            this.data.showHeaders = val;
            this.notify();
        }
    }

    setShowNoteNames(val) {
        if (this.data.showNoteNames !== val) {
            this.data.showNoteNames = val;
            this.notify();
        }
    }

    addPitchToChord(noteName) {
        this._pushHistory();
        // Target selected note if valid, otherwise last note
        let targetNote = null;
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        
        if (idx !== -1 && idx < targetNotes.length) {
            targetNote = targetNotes[idx];
        } else if (targetNotes.length > 0) {
            targetNote = targetNotes[targetNotes.length - 1];
        }

        if (!targetNote || targetNote.isRest) return; // Can't add pitch to rest
        
        const bestSpelling = this._getBestSpelling(noteName);

        // Avoid duplicates
        if (!targetNote.keys.includes(bestSpelling)) {
            targetNote.keys.push(bestSpelling);
            // Sort keys to ensure correct VexFlow rendering (Low to High)
            targetNote.keys.sort((a, b) => this._compareNotes(a, b));
            this.notify();
        }
    }

    addHairpin(type, startIdx = null, endIdx = null) {
        // type: 'cresc' or 'decresc'
        let s = startIdx;
        let e = endIdx;

        if (s === null) {
            s = Math.min(this.data.selectedIndex, this.data.selectionEndIndex);
            e = Math.max(this.data.selectedIndex, this.data.selectionEndIndex);
        }

        if (s === -1) return;
        if (e === null) e = s;

        const start = Math.min(s, e);
        const end = Math.max(s, e);
        const targetNotes = this._getActiveNotes();

        if (start === end) {
            if (startIdx === null && start < targetNotes.length - 1) {
                this._pushHistory();
                this.data.hairpins.push({
                    start: start,
                    end: start + 1,
                    type: type,
                    staff: this.activeStaff
                });
                this.data.selectionEndIndex = start + 1;
                this.notify();
                return;
            }
            return;
        }

        this._pushHistory();
        this.data.hairpins.push({
            start: start,
            end: end,
            type: type,
            staff: this.activeStaff
        });
        this.notify();
    }

    _adjustHairpinIndices(insertAt, count) {
        if (!Array.isArray(this.data.hairpins)) this.data.hairpins = [];
        this.data.hairpins.forEach(hp => {
            // Only adjust hairpins on the active staff
            if (hp.staff === this.activeStaff || (!hp.staff && this.activeStaff === 'treble')) {
                if (hp.start >= insertAt) hp.start += count;
                if (hp.end >= insertAt) hp.end += count;
            }
        });
    }

    changeNoteDuration(durationKey) {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            
            const oldBeats = this._getNoteBeats(note);
            
            // Preserve rest status
            const isRest = note.isRest;
            // Reset dot when explicitly picking a duration
            note.duration = durationKey + (isRest ? "r" : "");
            
            const newBeats = this._getNoteBeats(note);
            
            if (newBeats < oldBeats) {
                this._fillRemainder(idx, oldBeats - newBeats);
            }

            this.notify();
        }
    }

    toggleTie() {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            if (note.isRest) return; 

            // Toggle tie status
            note.isTied = !note.isTied;
            this.notify();
        }
    }

    toggleNoteDotted() {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            
            const oldBeats = this._getNoteBeats(note);

            if (note.duration.includes('d')) {
                note.duration = note.duration.replace('d', '');
            } else {
                if (note.duration.includes('r')) {
                    note.duration = note.duration.replace('r', 'dr');
                } else {
                    note.duration += 'd';
                }
            }
            
            const newBeats = this._getNoteBeats(note);
            if (newBeats < oldBeats) {
                this._fillRemainder(idx, oldBeats - newBeats);
            }

            this.notify();
        }
    }

    toggleEnharmonic() {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            if (note.isRest) return;

            const map = {
                'c#': 'db', 'db': 'c#',
                'd#': 'eb', 'eb': 'd#',
                'f#': 'gb', 'gb': 'f#',
                'g#': 'ab', 'ab': 'g#',
                'a#': 'bb', 'bb': 'a#'
            };

            let changed = false;
            note.keys = note.keys.map(k => {
                const [step, oct] = k.split('/');
                const stepLow = step.toLowerCase();
                if (map[stepLow]) {
                    changed = true;
                    return `${map[stepLow]}/${oct}`;
                }
                return k;
            });

            if (changed) this.notify();
        }
    }

    transposeSelection(semitones) {
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx === -1 || idx >= targetNotes.length) return;
        
        const note = targetNotes[idx];
        if (note.isRest) return;

        this._pushHistory();
        
        note.keys = note.keys.map(k => this._transposeKey(k, semitones));

        // Re-sort keys to ensure valid VexFlow rendering
        note.keys.sort((a, b) => this._compareNotes(a, b));

        this.notify();
    }

    _transposeKey(keyStr, semitones) {
        const [notePart, octPart] = keyStr.split('/');
        let octave = parseInt(octPart);
        const noteLower = notePart.toLowerCase();

        // 1. Convert to absolute semitone index
        const map = {
            'c': 0, 'c#': 1, 'db': 1,
            'd': 2, 'd#': 3, 'eb': 3,
            'e': 4, 
            'f': 5, 'f#': 6, 'gb': 6,
            'g': 7, 'g#': 8, 'ab': 8,
            'a': 9, 'a#': 10, 'bb': 10,
            'b': 11
        };

        if (map[noteLower] === undefined) return keyStr;

        let currentAbs = (octave * 12) + map[noteLower];
        let targetAbs = currentAbs + semitones;

        // 2. Convert back
        let newOctave = Math.floor(targetAbs / 12);
        let newNoteIdx = ((targetAbs % 12) + 12) % 12;

        // 3. Determine spelling based on Key Signature and Direction
        const keySig = this.data.keySignature;
        
        // Key Types
        const flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
        const sharpKeys = ['G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
        
        const sharps = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
        const flats  = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];

        let useFlats = false;

        if (flatKeys.includes(keySig)) {
            useFlats = true;
        } else if (sharpKeys.includes(keySig)) {
            useFlats = false;
        } else {
            // Neutral (C) - Use direction: Descending -> Flats, Ascending -> Sharps
            useFlats = semitones < 0;
        }

        const newNoteName = useFlats ? flats[newNoteIdx] : sharps[newNoteIdx];
        return `${newNoteName}/${newOctave}`;
    }

    toggleSlur() {
        this._pushHistory();
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            const note = targetNotes[idx];
            if (note.isRest) return; 
            note.isSlurred = !note.isSlurred;
            this.notify();
        }
    }

    _getNoteBeats(note) {
        let dur = note.duration.replace('r', '').replace('d', '');
        let isDotted = note.duration.includes('d');
        
        let beats = 1;
        if (dur === 'w') beats = 4;
        else if (dur === 'h') beats = 2;
        else if (dur === 'q') beats = 1;
        else if (dur === '8') beats = 0.5;
        else if (dur === '16') beats = 0.25;
        else if (dur === '32') beats = 0.125;
        else if (dur === '64') beats = 0.0625;
        else if (dur === '128') beats = 0.03125;
        
        if (isDotted) beats *= 1.5;
        if (note.isTriplet) beats *= (2/3);
        
        return beats;
    }

    _fillRemainder(changedIndex, beatsNeeded) {
        const targetNotes = this._getActiveNotes();
        const timeSig = this.data.timeSignature.split('/');
        const beatsPerMeas = parseInt(timeSig[0]);
        const denom = parseInt(timeSig[1]);
        const measureLimit = beatsPerMeas * (4 / denom); 
        
        let currentMeasureBeats = 0;
        let insertIndex = targetNotes.length;
        
        // Find the end of the measure containing changedIndex
        for (let i = 0; i < targetNotes.length; i++) {
            const nb = this._getNoteBeats(targetNotes[i]);
            
            if (currentMeasureBeats + nb > measureLimit + 0.001 && currentMeasureBeats > 0) {
                 if (i > changedIndex) {
                     insertIndex = i;
                     break;
                 }
                 currentMeasureBeats = 0;
            }
            
            currentMeasureBeats += nb;
        }
        
        if (insertIndex < changedIndex) insertIndex = changedIndex + 1;

        const rests = this._generateRests(beatsNeeded);
        targetNotes.splice(insertIndex, 0, ...rests);
    }

    _generateRests(beats) {
        const generated = [];
        let remaining = beats;
        const options = [
             { val: 4, code: 'w' }, { val: 3, code: 'hd' }, { val: 2, code: 'h' },
             { val: 1.5, code: 'qd' }, { val: 1, code: 'q' }, { val: 0.75, code: '8d' },
             { val: 0.5, code: '8' }, { val: 0.375, code: '16d' }, { val: 0.25, code: '16' },
             { val: 0.125, code: '32' }, { val: 0.0625, code: '64' }, { val: 0.03125, code: '128' }
        ];
        
        // Lower tolerance for smaller values
        while (remaining >= 0.03125) { 
            const match = options.find(o => o.val <= remaining + 0.001);
            if (match) {
                generated.push({
                    keys: ["b/4"],
                    duration: match.code + "r",
                    isRest: true
                });
                remaining -= match.val;
            } else { break; }
        }
        return generated;
    }

    _getBestSpelling(note) {
        const [key, oct] = note.split('/');
        // If not a sharp/flat, return as is (ignoring natural conversions for MVP)
        if (!key.includes('#') && !key.includes('b')) return note;
        
        const flatKeys = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
        const isFlatKey = flatKeys.includes(this.data.keySignature);
        const noteBase = key.toLowerCase();

        // Standard map for Piano inputs (Sharps) -> Flats
        const sharpToFlat = {
            'c#': 'db', 'd#': 'eb', 'f#': 'gb', 'g#': 'ab', 'a#': 'bb'
        };

        if (isFlatKey && sharpToFlat[noteBase]) {
            return `${sharpToFlat[noteBase]}/${oct}`;
        }
        
        return note;
    }

    addPitchToLastNote(noteName) {
        // Deprecated alias for compatibility, or simply redirect
        this.addPitchToChord(noteName);
    }

    copySelectedNote() {
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            this.clipboard = JSON.parse(JSON.stringify(targetNotes[idx]));
        }
    }

    pasteNote() {
        if (!this.clipboard) return;
        this._pushHistory();
        
        const newNote = JSON.parse(JSON.stringify(this.clipboard));
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            targetNotes[idx] = newNote;
            this.data.selectedIndex = idx;
            this.data.selectionEndIndex = idx;
        } else {
            targetNotes.push(newNote);
            this.data.selectedIndex = targetNotes.length - 1;
            this.data.selectionEndIndex = targetNotes.length - 1;
        }
        this.data.selectionType = 'note';
        this.notify();
    }

    _compareNotes(a, b) {
        // Helper to sort notes like c/4, c#/4, d/4, c/5
        const parse = (n) => {
            const [key, oct] = n.split('/');
            const octave = parseInt(oct);
            const notes = ['c','d','e','f','g','a','b'];
            // Fix: Use charAt(0) to get the base note regardless of accidentals
            const keyBase = key.charAt(0).toLowerCase();
            const index = notes.indexOf(keyBase);
            return octave * 100 + index;
        };
        return parse(a) - parse(b);
    }

    deleteLastNote() {
        const targetNotes = this._getActiveNotes();
        if (targetNotes.length > 0) {
            this._pushHistory();
            targetNotes.pop();
            // Clean up hairpins affecting last note
            const lastIdx = targetNotes.length;
            this.data.hairpins = this.data.hairpins.filter(hp => 
                (hp.staff === this.activeStaff || (!hp.staff && this.activeStaff === 'treble')) ? 
                (hp.start < lastIdx && hp.end < lastIdx) : true
            );
            
            this.data.selectedIndex = -1;
            this.data.selectionEndIndex = -1;
            this.data.selectionVoiceId = null;
            this.notify();
        }
    }

    deleteSelectedNote() {
        const targetNotes = this._getActiveNotes();
        const idx = this.data.selectedIndex;
        if (idx !== -1 && idx < targetNotes.length) {
            this.deleteCurrentSelection();
        } else {
            this.deleteLastNote();
        }
    }

    deleteCurrentSelection() {
        const targetNotes = this._getActiveNotes();
        const start = Math.min(this.data.selectedIndex, this.data.selectionEndIndex);
        const end = Math.max(this.data.selectedIndex, this.data.selectionEndIndex);
        
        if (start === -1 || start >= targetNotes.length) return;
        
        const selType = this.data.selectionType || 'note';

        this._pushHistory();

        if (selType === 'hairpin') {
             this.data.hairpins = this.data.hairpins.filter(hp => 
                !((hp.staff === this.activeStaff || (!hp.staff && this.activeStaff === 'treble')) && 
                  hp.start >= start && hp.end <= end)
             );
             this.data.selectionType = 'note';
        } else if (selType === 'tie') {
            const note = targetNotes[start];
            note.isTied = false;
            this.data.selectionType = 'note';
        } else if (selType === 'slur') {
            const note = targetNotes[start];
            note.isSlurred = false;
            this.data.selectionType = 'note';
        } else if (selType === 'note') {
            // Check if all selected items are already rests
            const allRests = targetNotes.slice(start, end + 1).every(n => n.isRest);

            if (allRests) {
                 const count = (end - start) + 1;
                 targetNotes.splice(start, count);

                 // Update Hairpins
                 this.data.hairpins = this.data.hairpins.filter(hp => {
                     if (hp.staff !== this.activeStaff && (hp.staff || this.activeStaff !== 'treble')) return true;
                     const intersects = !(hp.end < start || hp.start > end);
                     return !intersects;
                 });
                 
                 this.data.hairpins.forEach(hp => {
                     if (hp.staff !== this.activeStaff && (hp.staff || this.activeStaff !== 'treble')) return;
                     if (hp.start > end) hp.start -= count;
                     if (hp.end > end) hp.end -= count;
                 });

                 this.data.selectedIndex = -1;
                 this.data.selectionEndIndex = -1;

            } else {
                for (let i = start; i <= end; i++) {
                    const note = targetNotes[i];
                    note.isRest = true;
                    note.keys = ["b/4"];
                    if (!note.duration.includes('r')) note.duration += 'r';
                    note.isTied = false;
                    note.isSlurred = false;
                    note.isStaccato = false;
                    note.isAccent = false;
                    note.isMarcato = false;
                    note.isFermata = false;
                    delete note.dynamic;
                    delete note.lyric;
                }

                this.data.hairpins = this.data.hairpins.filter(hp => {
                    if (hp.staff !== this.activeStaff && (hp.staff || this.activeStaff !== 'treble')) return true;
                    if (hp.end < start) return true;
                    if (hp.start > end) return true;
                    return false; 
                });
            }
        }
        this.notify();
    }

    _rebalanceMeasures() {
        const targetNotes = this._getActiveNotes();
        const timeSig = this.data.timeSignature.split('/');
        const beatsPerMeasure = parseInt(timeSig[0]) * (4 / parseInt(timeSig[1])); // Normalized to quarter beats
        
        let currentMeasureBeats = 0;
        let i = 0;
        let loops = 0;
        
        while (i < targetNotes.length) {
            if (loops++ > 10000) break; // Safety
            
            const note = targetNotes[i];
            const noteBeats = this._getNoteBeats(note);
            
            // Skip triplets for splitting complexity
            if (note.isTriplet) {
                currentMeasureBeats += noteBeats;
                while (currentMeasureBeats >= beatsPerMeasure) {
                    currentMeasureBeats -= beatsPerMeasure;
                }
                i++;
                continue;
            }

            // Check overflow
            if (currentMeasureBeats + noteBeats > beatsPerMeasure + 0.001) {
                const available = beatsPerMeasure - currentMeasureBeats;
                
                // Only split if available space is >= 16th note (0.25)
                if (available >= 0.25) {
                    const parts = this._splitNote(note, available, noteBeats);
                    if (parts) {
                        // Replace
                        targetNotes.splice(i, 1, ...parts);
                        
                        // Current measure is full
                        currentMeasureBeats = 0;
                        i++; // Move to next part (remainder)
                        continue;
                    }
                }
                
                // Wrap without split
                currentMeasureBeats = (currentMeasureBeats + noteBeats) % beatsPerMeasure;
                i++;
            } else {
                currentMeasureBeats += noteBeats;
                // Perfect fit check
                if (Math.abs(currentMeasureBeats - beatsPerMeasure) < 0.001) {
                    currentMeasureBeats = 0;
                }
                i++;
            }
        }
    }

    _splitNote(originalNote, firstPartBeats, totalBeats) {
        // 1. Determine first part duration
        const firstDur = this._getDurationCodeFromBeats(firstPartBeats);
        if (!firstDur) return null; // Can't cleanly split

        const parts = [];
        
        // Part 1
        const p1 = this._createNoteFromBase(originalNote, firstDur);
        
        // Preserve lyric only on first part
        if (originalNote.lyric) p1.lyric = originalNote.lyric;

        if (!originalNote.isRest && (totalBeats - firstPartBeats > 0.001)) {
            p1.isTied = true;
        }
        parts.push(p1);
        
        // Part 2 (Remainder)
        let remaining = totalBeats - firstPartBeats;
        
        while (remaining >= 0.25) {
             const chunkDur = this._getLargestDurationCode(remaining);
             if (!chunkDur) break;
             
             const chunkBeats = this._getBeatsFromCode(chunkDur);
             const newNote = this._createNoteFromBase(originalNote, chunkDur);
             
             if (!originalNote.isRest) {
                 if (remaining - chunkBeats > 0.001) {
                     // Not the last piece, so it ties to next
                     newNote.isTied = true;
                 } else if (originalNote.isTied) {
                     // Last piece, inherit original tie
                     newNote.isTied = true;
                 }
             }
             
             parts.push(newNote);
             remaining -= chunkBeats;
        }
        
        return parts;
    }

    _createNoteFromBase(base, durationCode) {
        return {
            keys: [...base.keys],
            duration: durationCode + (base.isRest ? "r" : ""),
            isRest: base.isRest,
            isSlurred: base.isSlurred,
            isStaccato: base.isStaccato,
            isAccent: base.isAccent,
            isMarcato: base.isMarcato,
            isFermata: base.isFermata,
            dynamic: base.dynamic, // Preserve dynamic
            // Lyric is handled manually in _splitNote
            isTied: false, // Default false, set by caller
            isTriplet: false // Splitting triplet not supported
        };
    }

    _getDurationCodeFromBeats(beats) {
        const table = [
            {b: 4, c: 'w'}, {b: 3, c: 'hd'}, {b: 2, c: 'h'},
            {b: 1.5, c: 'qd'}, {b: 1, c: 'q'},
            {b: 0.75, c: '8d'}, {b: 0.5, c: '8'},
            {b: 0.375, c: '16d'}, {b: 0.25, c: '16'},
            {b: 0.125, c: '32'}, {b: 0.0625, c: '64'}, {b: 0.03125, c: '128'}
        ];
        const match = table.find(x => Math.abs(x.b - beats) < 0.001);
        return match ? match.c : null;
    }

    _getLargestDurationCode(maxBeats) {
        const table = [
            {b: 4, c: 'w'}, {b: 3, c: 'hd'}, {b: 2, c: 'h'},
            {b: 1.5, c: 'qd'}, {b: 1, c: 'q'},
            {b: 0.75, c: '8d'}, {b: 0.5, c: '8'},
            {b: 0.375, c: '16d'}, {b: 0.25, c: '16'},
            {b: 0.125, c: '32'}, {b: 0.0625, c: '64'}, {b: 0.03125, c: '128'}
        ];
        const match = table.find(x => x.b <= maxBeats + 0.001);
        return match ? match.c : '128';
    }

    _getBeatsFromCode(code) {
        let dur = code.replace('d','').replace('r','');
        let isDotted = code.includes('d');
        let b = 0;
        if(dur==='w') b=4;
        else if(dur==='h') b=2;
        else if(dur==='q') b=1;
        else if(dur==='8') b=0.5;
        else if(dur==='16') b=0.25;
        else if(dur==='32') b=0.125;
        else if(dur==='64') b=0.0625;
        else if(dur==='128') b=0.03125;
        if(isDotted) b *= 1.5;
        return b;
    }

    selectNote(index, staff = null, extend = false, voiceId = null) {
        // Selection does not trigger history
        if (staff && this.activeStaff !== staff) {
            this.activeStaff = staff;
        }

        if (extend && this.data.selectedIndex !== -1 && this.data.selectionVoiceId === voiceId) {
            // Extend selection within the same voice
            this.data.selectionEndIndex = index;
        } else {
            // New single selection
            this.data.selectedIndex = index;
            this.data.selectionEndIndex = index;
            this.data.selectionVoiceId = voiceId || null;
        }
        this.data.selectionType = 'note';
        this.notify();
    }

    selectTie(index, staff = null) {
        if (staff && this.activeStaff !== staff) {
            this.activeStaff = staff;
        }
        this.data.selectedIndex = index;
        this.data.selectionEndIndex = index;
        this.data.selectionType = 'tie';
        this.notify();
    }

    selectSlur(index, staff = null) {
        if (staff && this.activeStaff !== staff) {
            this.activeStaff = staff;
        }
        this.data.selectedIndex = index;
        this.data.selectionEndIndex = index;
        this.data.selectionType = 'slur';
        this.notify();
    }
    
    selectHairpin(start, end, staff = null) {
        if (staff && this.activeStaff !== staff) {
            this.activeStaff = staff;
        }
        this.data.selectedIndex = start;
        this.data.selectionEndIndex = end;
        this.data.selectionType = 'hairpin';
        this.notify();
    }

    selectNext(extend = false) {
        const targetNotes = this._getActiveNotes();
        const len = targetNotes.length;
        if (len === 0) return;
        
        let focus = extend ? this.data.selectionEndIndex : this.data.selectedIndex;
        
        if (focus === -1) {
            focus = 0;
        } else if (focus < len - 1) {
            focus++;
        }
        
        if (extend) {
            this.data.selectionEndIndex = focus;
            if (this.data.selectedIndex === -1) this.data.selectedIndex = 0;
        } else {
            this.data.selectedIndex = focus;
            this.data.selectionEndIndex = focus;
        }
        this.data.selectionType = 'note';
        this.notify();
    }

    selectPrev(extend = false) {
        const targetNotes = this._getActiveNotes();
        const len = targetNotes.length;
        if (len === 0) return;

        let focus = extend ? this.data.selectionEndIndex : this.data.selectedIndex;

        if (focus === -1) {
            focus = len - 1;
        } else if (focus > 0) {
            focus--;
        }
        
        if (extend) {
            this.data.selectionEndIndex = focus;
            if (this.data.selectedIndex === -1) this.data.selectedIndex = len - 1;
        } else {
            this.data.selectedIndex = focus;
            this.data.selectionEndIndex = focus;
        }
        this.data.selectionType = 'note'; 
        this.notify();
    }

    selectClef(staff) {
        this.activeStaff = staff;
        this.data.selectionType = 'clef';
        this.data.selectedIndex = -1;
        this.data.selectionEndIndex = -1;
        this.data.selectionVoiceId = null;
        this.notify();
    }

    getScore() {
        return this.data;
    }

    addVoice(staff = 'treble') {
        this._pushHistory();
        // Original staff notes are always Voice 1, so extra voices start at 2
        const voiceNumber = this.data.voices.length + 2;
        // Use a simple incrementing counter to avoid Date.now() collisions
        if (!this._voiceCounter) this._voiceCounter = 1;
        const voiceId = ++this._voiceCounter;

        // Deactivate any previously active extra voice
        if (Array.isArray(this.data.voices)) {
            this.data.voices.forEach(v => v.isActive = false);
        }

        const voice = {
            id: voiceId,
            name: `Voice ${voiceNumber}`,
            staff: staff,
            notes: [],
            isActive: true,
            color: this._getVoiceColor(this.data.voices.length)
        };
        this.data.voices.push(voice);
        // Select this new voice as the active extra voice
        this.data.activeVoiceId = voiceId;

        this.notify();
        return voice;
    }

    removeVoice(voiceId) {
        this._pushHistory();
        this.data.voices = this.data.voices.filter(v => v.id !== voiceId);

        // If we removed the active voice, fall back to base voice 1
        if (this.data.activeVoiceId === voiceId) {
            this.data.activeVoiceId = null;
            this.data.selectionVoiceId = null;
        }

        // Ensure only the matching id (if any) is active
        this.data.voices.forEach(v => v.isActive = (v.id === this.data.activeVoiceId));

        this.notify();
    }

    setActiveVoice(voiceId) {
        // null / undefined => base Voice 1 (no extra voice selected)
        if (voiceId === null || voiceId === undefined) {
            this.data.activeVoiceId = null;
            this.data.selectionVoiceId = null;
            this.data.voices.forEach(v => v.isActive = false);
        } else {
            this.data.activeVoiceId = voiceId;
            this.data.selectionVoiceId = voiceId;
            this.data.voices.forEach(v => v.isActive = (v.id === voiceId));
        }
        this.notify();
    }

    addNoteToVoice(voiceId, noteName, duration, options = {}) {
        this._pushHistory();
        const voice = (this.data.voices || []).find(v => v.id === voiceId);
        if (!voice) return;

        const isRest = typeof options === 'boolean' ? options : (options.isRest || false);
        const finalNote = isRest ? noteName : this._getBestSpelling(noteName);
        
        const newNote = {
            keys: [finalNote],
            duration: duration + (isRest ? "r" : ""),
            isRest: isRest,
            isTriplet: options.isTriplet || false
        };

        const targetNotes = voice.notes || [];
        let insertIndex = targetNotes.length;

        // Only respect current selection if it's in the same voice
        if (this.data.selectionVoiceId === voiceId &&
            this.data.selectedIndex !== -1 &&
            this.data.selectedIndex < targetNotes.length) {
            insertIndex = this.data.selectedIndex + 1;
            targetNotes.splice(insertIndex, 0, newNote);
        } else {
            targetNotes.push(newNote);
            insertIndex = targetNotes.length - 1;
        }

        // Update selection to the newly added note in this voice
        this.data.selectedIndex = insertIndex;
        this.data.selectionEndIndex = insertIndex;
        this.data.selectionVoiceId = voiceId;
        this.data.selectionType = 'note';

        voice.notes = targetNotes;
        this.notify();
    }

    _getVoiceColor(index) {
        // Cycle secondary voices through red, green, and purple hues
        const colors = ['#ef4444', '#10b981', '#8b5cf6', '#ef4444', '#10b981'];
        return colors[index % colors.length];
    }

    getActiveVoice() {
        // Base voice 1 is represented by activeVoiceId === null
        const voices = this.data.voices || [];
        if (!Array.isArray(voices) || voices.length === 0) return null;
        if (this.data.activeVoiceId === null || this.data.activeVoiceId === undefined) return null;
        return voices.find(v => v.id === this.data.activeVoiceId) || null;
    }
}