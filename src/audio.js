export class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.baseFrequency = 440;
        
        // Setup Main Audio Graph
        this.mainNodes = this._setupAudioGraph(this.ctx);
        this.compressor = this.mainNodes.compressor;
        this.masterGain = this.mainNodes.masterGain;

        this.isPlaying = false;
        this.activeNodes = []; // Track active oscillators for clean stop
        this.visualQueue = []; // Queue for visual callbacks

        this.currentInstrument = 'guitar';
        this.tuningSystem = 'et';
        this.currentKey = 'C';
        
        // Sample Buffers
        this.samples = {};
        this._loadSamples();

        this.presets = {
            'piano': { type: 'sampler' },
            'guitar': { type: 'modeled' }, // Karplus-Strong
            'synth': { 
                type: ['square', 'sawtooth'], 
                gains: [0.4, 0.3],
                attack: 0.05, decay: 0.2, sustain: 0.4, release: 0.1, 
                detune: 5 
            },
            'strings': { 
                type: ['sawtooth', 'sawtooth'], 
                gains: [0.5, 0.5],
                attack: 0.2, decay: 0.1, sustain: 0.8, release: 0.4, 
                detune: 12 
            },
            'flute': {
                type: ['sine', 'triangle'],
                gains: [0.8, 0.2],
                attack: 0.1, decay: 0.1, sustain: 0.9, release: 0.2,
                detune: 2
            }
        };
    }

    _setupAudioGraph(context) {
        // Master Compressor
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -20;
        compressor.knee.value = 30;
        compressor.ratio.value = 12;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        compressor.connect(context.destination);

        const masterGain = context.createGain();
        masterGain.gain.value = 0.5;
        masterGain.connect(compressor);

        // Reverb Effect (Convolver)
        const convolver = context.createConvolver();
        convolver.buffer = this._generateImpulse(context, 2.5, 2.5); // 2.5s tail

        // Reverb Gain (Wet Mix)
        const reverbGain = context.createGain();
        reverbGain.gain.value = 0.25;

        // Route: Master -> Convolver -> ReverbGain -> Compressor
        masterGain.connect(convolver);
        convolver.connect(reverbGain);
        reverbGain.connect(compressor);
        
        return { compressor, masterGain, convolver, reverbGain };
    }

    async _loadSamples() {
        const files = {
            'C0': 'piano_c0.mp3',
            'E0': 'piano_e0.mp3',
            'G0': 'piano_g0.mp3',
            'C1': 'piano_c1.mp3',
            'E1': 'piano_e1.mp3',
            'G1': 'piano_g1.mp3',
            'C2': 'piano_c2.mp3',
            'E2': 'piano_e2.mp3',
            'G2': 'piano_g2.mp3',
            'C3': 'piano_c3.mp3',
            'E3': 'piano_e3.mp3',
            'G3': 'piano_g3.mp3',
            'C4': 'piano_c4.mp3',
            'E4': 'piano_e4.mp3',
            'G4': 'piano_g4.mp3',
            'C5': 'piano_c5.mp3',
            'E5': 'piano_e5.mp3',
            'G5': 'piano_g5.mp3',
            'C6': 'piano_c6.mp3',
            'E6': 'piano_e6.mp3',
            'G6': 'piano_g6.mp3',
            'C7': 'piano_c7.mp3',
            'E7': 'piano_e7.mp3',
            'G7': 'piano_g7.mp3'
        };

        for (const [note, url] of Object.entries(files)) {
            try {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
                this.samples[note] = audioBuffer;
            } catch (e) {
                console.warn(`Failed to load sample ${note}`, e);
            }
        }
    }

    // Generate Karplus-Strong buffer in software to ensure correct tuning
    // Compensates for block-processing latency in Web Audio API feedback loops
    _generateGuitarBuffer(ctx, freq, duration) {
        const sr = ctx.sampleRate;
        // Round to nearest integer period for the buffer size
        let period = Math.round(sr / freq);
        if (period < 2) period = 2;
        
        // Calculate the actual frequency this period represents
        const baseFreq = sr / period;
        
        // We'll play it back at a rate that corrects the pitch
        const playbackRate = freq / baseFreq;
        
        const totalSamples = Math.ceil(sr * duration);
        const buffer = ctx.createBuffer(1, totalSamples, sr);
        const data = buffer.getChannelData(0);
        
        // The "String" ring buffer
        const stringState = new Float32Array(period);
        
        // Initialize with noise (Excitation)
        for (let i = 0; i < period; i++) {
            stringState[i] = (Math.random() * 2 - 1);
        }
        
        let pIndex = 0;
        // Decay factor - determines sustain
        const decay = 0.993;

        for (let i = 0; i < totalSamples; i++) {
            const currentVal = stringState[pIndex];
            const nextIndex = (pIndex + 1) % period;
            const nextVal = stringState[nextIndex];

            // Karplus-Strong Lowpass averaging
            const newVal = (currentVal + nextVal) * 0.5 * decay;
            
            // Write output
            data[i] = currentVal;
            
            // Update string state (Feedback)
            stringState[pIndex] = newVal;
            
            // Advance pointer
            pIndex = nextIndex;
        }
        
        return { buffer, playbackRate };
    }

    setInstrument(name) {
        if (this.presets[name]) {
            this.currentInstrument = name;
        }
    }

    setBaseFrequency(freq) {
        this.baseFrequency = freq;
    }

    setTuningSystem(sys) {
        this.tuningSystem = sys;
    }

    setKey(key) {
        this.currentKey = key;
    }

    _generateImpulse(ctx, duration, decay) {
        const rate = ctx.sampleRate;
        const length = rate * duration;
        const impulse = ctx.createBuffer(2, length, rate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            // Exponential decay noise
            const n = i / length;
            const vol = Math.pow(1 - n, decay);
            left[i] = (Math.random() * 2 - 1) * vol;
            right[i] = (Math.random() * 2 - 1) * vol;
        }
        return impulse;
    }

    resume() {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    frequencyFromNote(note) {
        // Simple parser for VexFlow note format "c/4", "f#/5"
        // Reference: A4 = this.baseFrequency (default 440)
        const notes = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
        const parts = note.split('/');
        let key = parts[0].toLowerCase();
        let octave = parseInt(parts[1]);

        let keyIndex = notes.indexOf(key);
        // Handle flats if necessary (e.g. db -> c#) - Basic mapping
        if (keyIndex === -1 && key.includes('b')) {
            // Very simple flat handling
            const natural = key[0];
            const naturalIndex = notes.indexOf(natural);
            keyIndex = (naturalIndex - 1 + 12) % 12;
        }

        // Absolute semitone index
        const absIndex = (octave * 12) + keyIndex;
        const a4Index = (4 * 12) + 9;

        // Equal Temperament Calculation (Default)
        if (this.tuningSystem === 'et' || !this.tuningSystem) {
            const semitonesFromA4 = absIndex - a4Index;
            return this.baseFrequency * Math.pow(2, semitonesFromA4 / 12);
        }

        // Alternate Tuning Calculation
        return this._calculateAlternateTuning(absIndex, a4Index);
    }

    _calculateAlternateTuning(absIndex, a4Index) {
        // 1. Determine Key Center (Tonic) Index
        const notes = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
        
        // Map Key Signature to index (e.g., 'C' -> 0, 'F#' -> 6, 'Bb' -> 10)
        let tonicStr = this.currentKey.toLowerCase();
        let tonicIndex = notes.indexOf(tonicStr);
        if (tonicIndex === -1 && tonicStr.includes('b')) {
             const natural = tonicStr[0];
             const naturalIndex = notes.indexOf(natural);
             tonicIndex = (naturalIndex - 1 + 12) % 12;
        }
        if (tonicIndex === -1) tonicIndex = 0; // Default C

        // 2. Anchor Tonic Frequency to ET
        // We find the frequency of the Tonic in Octave 4 using standard ET relative to A4
        // This keeps the "Key Center" stable regardless of tuning system
        const tonicAbsIndex = (4 * 12) + tonicIndex; 
        const tonicFromA4 = tonicAbsIndex - a4Index;
        const tonicFreq = this.baseFrequency * Math.pow(2, tonicFromA4 / 12);

        // 3. Calculate Interval from Tonic
        const deltaSemitones = absIndex - tonicAbsIndex;
        
        // 4. Calculate Octave and Interval Class
        const octaves = Math.floor(deltaSemitones / 12);
        const intervalClass = (deltaSemitones % 12 + 12) % 12;

        // 5. Apply Ratios
        let ratio = 1.0;
        
        if (this.tuningSystem === 'just') {
            // 5-Limit Just Intonation
            // C  db  D   eb  E   F   f#  G   ab  A   bb  B
            // 1  16/15 9/8 6/5 5/4 4/3 45/32 3/2 8/5 5/3 9/5 15/8
            const ratios = [
                1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 16/9, 15/8
            ];
            ratio = ratios[intervalClass];
        } else if (this.tuningSystem === 'pyth') {
            // Pythagorean (3-Limit)
            // Based on perfect fifths (3/2)
            const ratios = [
                1, 256/243, 9/8, 32/27, 81/64, 4/3, 729/512, 3/2, 128/81, 27/16, 16/9, 243/128
            ];
            ratio = ratios[intervalClass];
        } else if (this.tuningSystem === 'mean') {
            // Quarter-Comma Meantone
            // Perfect 5th is narrowed by 1/4 of a syntonic comma
            // Syntonic comma = 81/80. 1/4 comma ~ 1.003
            // 5th = 3/2 / (81/80)^0.25 = 1.49535
            // Approx ratios derived from generated fifths stack
            const fifth = Math.pow(5, 0.25); // In 1/4 comma meantone, 4 fifths = 5/1 (2 octaves + major third). So fifth = 5^0.25 = 1.4953
            // This is messy to hardcode array, usually generated. 
            // Simplified lookup for MVP:
            const ratios = [
                1, 1.0699, 1.1180, 1.1963, 1.2500, 1.3375, 1.3975, 1.4953, 1.6000, 1.6719, 1.7889, 1.8692
            ];
            ratio = ratios[intervalClass];
        } else if (this.tuningSystem === 'werck') {
             // Werckmeister III
             // Unequal temperament
             const ratios = [
                 1, 1.0535, 1.1174, 1.1858, 1.2528, 1.3348, 1.4142, 1.4962, 1.5801, 1.6705, 1.7818, 1.8809
             ];
             ratio = ratios[intervalClass];
        }

        return tonicFreq * Math.pow(2, octaves) * ratio;
    }

    playTone(freq, duration, time, articulation = 'normal', velocity = 0.5) {
        // Ensure context is running (extra safety)
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(e => console.error(e));
        }

        // Ensure Master Gain is audible for manual play (stop() fades it to 0)
        // Check both isPlaying flag AND if gain was actually zeroed
        if (!this.isPlaying) {
             this.masterGain.gain.cancelScheduledValues(time);
             this.masterGain.gain.setValueAtTime(0.5, time);
        }

        this.scheduleTone(this.ctx, this.masterGain, freq, duration, time, articulation, velocity, this.currentInstrument, this.activeNodes);
    }

    scheduleTone(ctx, outputNode, freq, duration, time, articulation, velocity, instrumentName, trackerList = null) {
        const preset = this.presets[instrumentName] || this.presets['piano'];

        // Adjust parameters based on articulation
        let effDuration = duration;
        let effVelocity = velocity;

        if (articulation === 'staccato') {
            effDuration = duration * 0.5;
        } else if (articulation === 'accent') {
            effVelocity = Math.min(1.0, velocity * 1.3);
        } else if (articulation === 'marcato') {
            effDuration = duration * 0.8;
            effVelocity = Math.min(1.0, velocity * 1.3);
        }

        if (preset.type === 'sampler') {
            this._playSampled(ctx, outputNode, freq, effDuration, time, effVelocity);
        } else if (preset.type === 'modeled') {
            this._playModeledGuitar(ctx, outputNode, freq, effDuration, time, effVelocity, articulation, trackerList);
        } else {
            this._playSynthesized(ctx, outputNode, preset, freq, effDuration, time, articulation, effVelocity, trackerList);
        }
    }

    _playSampled(ctx, outputNode, freq, duration, time, velocity) {
        // 1. Find closest sample
        // Frequencies of samples
        const sampleFreqs = {
            'C0': 16.35, 'E0': 20.60, 'G0': 24.50,
            'C1': 32.70, 'E1': 41.20, 'G1': 49.00,
            'C2': 65.41, 'E2': 82.41, 'G2': 98.00,
            'C3': 130.81, 'E3': 164.81, 'G3': 196.00,
            'C4': 261.63, 'E4': 329.63, 'G4': 392.00,
            'C5': 523.25, 'E5': 659.26, 'G5': 783.99,
            'C6': 1046.50, 'E6': 1318.51, 'G6': 1567.98,
            'C7': 2093.00, 'E7': 2637.02, 'G7': 3135.96
        };
        
        let bestSample = null;
        let minDiff = Infinity;
        let bestBaseFreq = 261.63; // Default C4

        // Fallback to C4 if samples not loaded yet
        if (Object.keys(this.samples).length === 0) {
            // If samples aren't ready, fallback to synth (recurse to synthesized on same context)
            const preset = this.presets['synth'];
            this._playSynthesized(ctx, outputNode, preset, freq, duration, time, 'normal', velocity * 0.5);
            return;
        }

        for (const [note, sFreq] of Object.entries(sampleFreqs)) {
            if (this.samples[note]) {
                const diff = Math.abs(Math.log2(freq / sFreq));
                if (diff < minDiff) {
                    minDiff = diff;
                    bestSample = this.samples[note];
                    bestBaseFreq = sFreq;
                }
            }
        }

        if (!bestSample) return;

        const source = ctx.createBufferSource();
        source.buffer = bestSample;
        
        // Pitch shift
        // rate = targetFreq / baseFreq
        source.playbackRate.value = freq / bestBaseFreq;

        const gain = ctx.createGain();
        gain.gain.value = velocity;
        
        // Envelope for release
        gain.gain.setValueAtTime(velocity, time);
        gain.gain.setValueAtTime(velocity, time + duration);
        gain.gain.linearRampToValueAtTime(0, time + duration + 0.2);

        source.connect(gain);
        gain.connect(outputNode);

        source.start(time);
        source.stop(time + duration + 0.5);
    }

    _playModeledGuitar(ctx, outputNode, freq, duration, time, velocity, articulation, trackerList) {
        // Pre-computed Karplus-Strong to avoid Web Audio loop latency tuning issues
        const { buffer, playbackRate } = this._generateGuitarBuffer(ctx, freq, duration + 0.5); // Add tail

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;

        // Apply Pluck Filter (Tone) - Brighter for higher velocity
        const pluckFilter = ctx.createBiquadFilter();
        pluckFilter.type = 'lowpass';
        pluckFilter.frequency.value = 2000 + (velocity * 3000);
        
        // Envelope Gain
        const gain = ctx.createGain();
        const sustainVal = articulation === 'legato' ? 0.8 : 0.6;
        
        // Envelope shape
        gain.gain.setValueAtTime(velocity, time);
        // Quick decay to sustain level
        gain.gain.exponentialRampToValueAtTime(Math.max(0.01, velocity * 0.6), time + 0.1);
        
        if (articulation === 'legato') {
             gain.gain.setValueAtTime(velocity * 0.6, time + duration);
        } else {
             // Natural exponential decay for plucked string
             gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        }
        
        // Mute at end
        gain.gain.linearRampToValueAtTime(0, time + duration + 0.1);

        // Body Resonance (The "Wood" Sound) - Post-process the string sound
        const bodyGain = ctx.createGain();
        bodyGain.gain.value = 1.0; 

        const bodyFilter1 = ctx.createBiquadFilter();
        bodyFilter1.type = 'peaking';
        bodyFilter1.frequency.value = 110; 
        bodyFilter1.gain.value = 5;
        bodyFilter1.Q.value = 1.5;

        const bodyFilter2 = ctx.createBiquadFilter();
        bodyFilter2.type = 'peaking';
        bodyFilter2.frequency.value = 220;
        bodyFilter2.gain.value = 3;
        bodyFilter2.Q.value = 1.0;

        // Connect Graph
        source.connect(pluckFilter);
        pluckFilter.connect(gain);
        
        gain.connect(bodyFilter1);
        bodyFilter1.connect(bodyFilter2);
        bodyFilter2.connect(bodyGain);
        bodyGain.connect(outputNode);

        source.start(time);
        source.stop(time + duration + 0.2);
        
        if (trackerList) {
            // Track active nodes for global stop
            const activeNode = { osc: [source], gain: gain }; 
            trackerList.push(activeNode);
            
            source.onended = () => {
                 const idx = trackerList.indexOf(activeNode);
                 if (idx > -1) trackerList.splice(idx, 1);
            };
        }
    }

    _playSynthesized(ctx, outputNode, preset, freq, duration, time, articulation, velocity, trackerList) {
        // Dual Oscillator for richer tone
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = preset.type[0];
        osc2.type = preset.type[1]; // Adds body

        osc1.frequency.value = freq;
        osc2.frequency.value = freq; 
        
        if (preset.detune) {
            osc2.detune.value = preset.detune;
        }

        // Mix Gain
        const osc1Gain = ctx.createGain();
        const osc2Gain = ctx.createGain();
        osc1Gain.gain.value = preset.gains[0] * velocity; // Scale by velocity
        osc2Gain.gain.value = preset.gains[1] * velocity; // Scale by velocity

        osc1.connect(osc1Gain);
        osc2.connect(osc2Gain);
        
        osc1Gain.connect(gain);
        osc2Gain.connect(gain);

        // Envelope
        const attack = preset.attack;
        const decay = preset.decay;
        const sustain = preset.sustain; // Sustain level (0-1)
        const release = preset.release;

        // Start Envelope
        gain.gain.setValueAtTime(0, time);
        
        // Attack
        gain.gain.linearRampToValueAtTime(1.0, time + attack);
        
        if (articulation === 'legato') {
            // Sustain for legato - smoother transition, less decay
            gain.gain.setTargetAtTime(sustain, time + attack, decay * 2); 
            // Hold full sustain until end
            gain.gain.setValueAtTime(sustain, time + duration);
            // Quick release to avoid muddy overlap but smoother than staccato
            gain.gain.linearRampToValueAtTime(0, time + duration + 0.1); 
        } else {
            // Normal: Attack -> Decay to Sustain -> Release
            // Decay
            gain.gain.exponentialRampToValueAtTime(Math.max(0.001, sustain), time + attack + decay);
            
            // Release at end of duration
            gain.gain.setValueAtTime(sustain, time + duration);
            gain.gain.linearRampToValueAtTime(0, time + duration + release);
        }

        gain.connect(outputNode);

        osc1.start(time);
        osc2.start(time);
        
        const stopPadding = release + 0.1;
        const stopTime = time + duration + stopPadding;
        osc1.stop(stopTime);
        osc2.stop(stopTime);

        if (trackerList) {
            // Track active nodes
            const activeNode = { osc: [osc1, osc2], gain: gain };
            trackerList.push(activeNode);
            
            // Cleanup when done
            osc1.onended = () => {
                const idx = trackerList.indexOf(activeNode);
                if (idx > -1) trackerList.splice(idx, 1);
            };
        }
    }

    playClick(time, isDownbeat) {
        // Used in live playback, so default to this.ctx and masterGain
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.frequency.value = isDownbeat ? 1200 : 800;
        osc.type = 'square';
        
        gain.gain.setValueAtTime(0.1, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.1);
    }

    playScore(scoreData, onNotePlay = null, onFinish = null, metronome = false, startIndex = 0) {
        this.stop(); // Clear previous
        this.resume();
        this.isPlaying = true;
        this.visualQueue = [];
        this.setBaseFrequency(scoreData.baseFrequency || 440);

        // Set instrument for playback
        if (scoreData.instrument) {
            this.setInstrument(scoreData.instrument);
        }

        // Reset master gain
        this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.masterGain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        
        const tempo = scoreData.tempo;
        const secondsPerBeat = 60 / tempo;
        const startTimeAudio = this.ctx.currentTime + 0.1; 
        
        // 1. Build Unified Timeline
        const trebleEvents = this._buildStaffTimeline(scoreData.notes || [], 'treble');
        const bassEvents = this._buildStaffTimeline(scoreData.notesBass || [], 'bass');

        // Include additional voices in unified timeline
        let voiceEvents = [];
        if (scoreData.voices && Array.isArray(scoreData.voices)) {
            scoreData.voices.forEach((voice, vIndex) => {
                if (!voice || !voice.notes || voice.notes.length === 0) return;
                const staffName = voice.staff || 'treble';
                const vEvents = this._buildStaffTimeline(voice.notes, staffName);
                vEvents.forEach(ev => {
                    ev.staff = staffName;
                    ev.isVoice = true;
                    ev.voiceIndex = vIndex;
                });
                voiceEvents.push(...vEvents);
            });
        }

        const allEvents = [...trebleEvents, ...bassEvents, ...voiceEvents];
        
        // Sort by start time
        allEvents.sort((a, b) => a.startTime - b.startTime);
        
        // 2. Determine Start Time (Beats)
        let startBeatTime = 0;
        if (startIndex > 0) {
            // Assume selection refers to treble timeline for simplicity of "Play from Selection"
            // Find the event corresponding to this index
            const startEvent = trebleEvents.find(e => e.index === startIndex);
            if (startEvent) startBeatTime = startEvent.startTime;
        }

        // 3. Schedule Events
        let maxEndTime = 0;
        
        // Calculate Fermata Time Drift map
        // To strictly sync timeline visually and audibly with fermatas, we need to map beat time -> real time
        // This is complex. For MVP, we will extend duration of the NOTE, but not stop the timeline.
        // Wait, if we don't stop timeline, notes will overlap.
        // Let's do a simple pass to calculate real start times.
        
        const beatToRealTime = new Map();
        let currentRealTime = startTimeAudio;
        let lastBeat = 0;
        
        // We need a sorted list of all unique beat times where events occur
        const uniqueBeats = [...new Set(allEvents.map(e => e.startTime))].sort((a,b) => a-b);
        
        // Add end beat approximation
        if(uniqueBeats.length > 0) uniqueBeats.push(uniqueBeats[uniqueBeats.length-1] + 4); 

        // Naive approach: Just process events in order.
        // Problem: Events happen simultaneously.
        // Better: Group events by Start Time.
        
        const eventsByTime = {};
        allEvents.forEach(e => {
            if(!eventsByTime[e.startTime]) eventsByTime[e.startTime] = [];
            eventsByTime[e.startTime].push(e);
        });
        
        const sortedStartTimes = Object.keys(eventsByTime).map(parseFloat).sort((a,b) => a-b);
        
        // Recalculate start times with drift
        const fermataScale = scoreData.fermataScale || 2.0;
        let accumulatedDrift = 0;
        let previousBeat = 0;
        
        // Note: This logic assumes monophonic timeline drift (system-wide fermata).
        // If one part has fermata and other doesn't, this breaks. 
        // Standard notation: Fermata usually applies to all parts at that moment.
        
        allEvents.forEach(event => {
             // 1. Calculate Standard Time
             if (event.startTime < startBeatTime) return;
             
             const offsetBeats = event.startTime - startBeatTime;
             // We need to know how much fermata drift happened BEFORE this event
             // This is hard without linear processing.
        });
        
        // Let's simplify: Just extend duration. Let overlap happen if parts desync.
        // But for single line (piano), we want the pause.
        // Let's check if ANY note at a specific time has fermata.
        
        const fermataBeats = new Set();
        allEvents.forEach(e => {
            if (e.note.isFermata) fermataBeats.add(e.startTime);
        });
        
        allEvents.forEach(event => {
            if (event.startTime < startBeatTime) return;

            // Calculate drift based on previous fermatas
            let drift = 0;
            for (let b of fermataBeats) {
                if (b < event.startTime && b >= startBeatTime) {
                    // How long is the beat that had the fermata?
                    // We need the duration of the note that had the fermata.
                    // This assumes the fermata note was the "driver" of that beat.
                    // Approximate: Add (Scale - 1) * secondsPerBeat * (duration of fermata note?)
                    // Simplified: Add 1 beat worth of time * (Scale - 1)
                    drift += (secondsPerBeat * (fermataScale - 1));
                }
            }

            const offsetBeats = event.startTime - startBeatTime;
            const absoluteTime = startTimeAudio + (offsetBeats * secondsPerBeat) + drift;
            
            let durationSec = event.duration * secondsPerBeat;
            if (event.note.isFermata) {
                durationSec *= fermataScale;
            }

            // Calculate Dynamic
            const dynamicGain = this._calculateDynamic(event.index, event.staff, scoreData);

            // Determine Articulation
            let articulation = 'normal';
            if (event.note.isSlurred) articulation = 'legato';
            else if (event.note.isStaccato) articulation = 'staccato';
            else if (event.note.isMarcato) articulation = 'marcato';
            else if (event.note.isAccent) articulation = 'accent';
            else if (event.note.isTenuto) articulation = 'tenuto';

            // Schedule Audio
            event.note.keys.forEach(key => {
                const freq = this.frequencyFromNote(key);
                this.playTone(freq, durationSec, absoluteTime, articulation, dynamicGain);
            });

            // Schedule Visuals
            this.visualQueue.push({
                time: absoluteTime,
                index: event.index,
                staff: event.staff,
                duration: durationSec
            });

            if (absoluteTime + durationSec > maxEndTime) {
                maxEndTime = absoluteTime + durationSec;
            }
        });

        // 4. Schedule Metronome
        if (metronome) {
            const timeSig = scoreData.timeSignature.split('/');
            const beatsPerMeasure = parseInt(timeSig[0]);
            
            // Calculate total duration in beats to play
            const totalDurationBeats = (maxEndTime - startTimeAudio) / secondsPerBeat;
            const endBeat = startBeatTime + totalDurationBeats + 1; // Buffer
            
            // Align startBeatTime to next beat or current if integer
            let currentBeat = Math.ceil(startBeatTime);
            if (Math.abs(currentBeat - startBeatTime) < 0.001) currentBeat = Math.round(startBeatTime);

            for (let b = currentBeat; b < endBeat; b++) {
                 const beatOffset = b - startBeatTime;
                 if (beatOffset < 0) continue;
                 
                 const time = startTimeAudio + (beatOffset * secondsPerBeat);
                 const isDownbeat = b % beatsPerMeasure === 0;
                 
                 this.playClick(time, isDownbeat);
            }
        }

        // 5. Start Animation Loop to sync Visuals with Audio Time
        const monitor = () => {
            if (!this.isPlaying) return;
            
            const now = this.ctx.currentTime;
            
            // Process queue events that are due
            while (this.visualQueue.length > 0 && this.visualQueue[0].time <= now) {
                const event = this.visualQueue.shift();
                if (onNotePlay) onNotePlay(event.index, event.duration, event.staff);
            }
            
            // Check if finished (allow small buffer for tail)
            if (this.visualQueue.length === 0 && now > maxEndTime + 0.5) {
                this.stop();
                if (onFinish) onFinish();
                return;
            }
            
            requestAnimationFrame(monitor);
        };
        requestAnimationFrame(monitor);
    }

    _buildStaffTimeline(notes, staffName) {
        if (!notes) return [];
        const events = [];
        let currentTime = 0;
        const handledTieIndices = new Set();
        
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            const beatDuration = this._getNoteDurationInBeats(note);
            
            if (!note.isRest && !handledTieIndices.has(i)) {
                let audioDuration = beatDuration;
                let lookAhead = i + 1;
                let currentTieNote = note;
                
                if (currentTieNote.isTied) {
                     while(lookAhead < notes.length) {
                         const next = notes[lookAhead];
                         if (next.isRest) break;
                         audioDuration += this._getNoteDurationInBeats(next);
                         handledTieIndices.add(lookAhead);
                         currentTieNote = next;
                         lookAhead++;
                         if (!currentTieNote.isTied) break;
                     }
                }
                
                events.push({
                    note: note,
                    startTime: currentTime,
                    duration: audioDuration,
                    index: i,
                    staff: staffName
                });
            }
            currentTime += beatDuration;
        }
        
        return events;
    }

    _calculateDynamic(index, staff, scoreData) {
        const notes = staff === 'bass' ? scoreData.notesBass : scoreData.notes;
        if (!notes || !Array.isArray(notes)) return 0.5;

        // 1. Base Dynamic
        let dynamicValue = 0.5;
        // Expanded range for pppp to ffff, including sfz and fz
        const dynMap = { 
            'pppp': 0.1, 'ppp': 0.2, 'pp': 0.3, 'p': 0.4, 
            'mp': 0.5, 'mf': 0.6, 
            'f': 0.7, 'ff': 0.8, 'fff': 0.9, 'ffff': 1.0,
            'sfz': 0.85, 'fz': 0.8
        };
        
        // Walk backward until we find a defined note with a dynamic marking
        for (let k = index; k >= 0; k--) {
            const n = notes[k];
            if (!n) continue;
            if (n.dynamic && dynMap[n.dynamic]) {
                dynamicValue = dynMap[n.dynamic];
                break;
            }
        }

        // 2. Hairpins
        if (scoreData.hairpins) {
            const hairpin = scoreData.hairpins.find(hp => {
                const hpStaff = hp.staff || 'treble';
                return hpStaff === staff && index >= hp.start && index <= hp.end;
            });
            
            if (hairpin) {
                const startDyn = dynamicValue;
                let endDyn = dynamicValue;
                const targetOffset = hairpin.type === 'cresc' ? 0.3 : -0.3;
                
                const endNote = notes[hairpin.end];
                if (endNote && endNote.dynamic && dynMap[endNote.dynamic]) {
                    endDyn = dynMap[endNote.dynamic];
                } else {
                    endDyn = Math.max(0.1, Math.min(1.0, startDyn + targetOffset));
                }
                
                const totalLen = hairpin.end - hairpin.start;
                const progress = (index - hairpin.start) / Math.max(1, totalLen);
                return startDyn + (endDyn - startDyn) * progress;
            }
        }
        
        // 3. Sfz/Fz articulation effects - add accent behavior
        const currentNote = notes[index];
        if (currentNote) {
            if (currentNote.dynamic === 'sfz' || currentNote.dynamic === 'fz') {
                // Sfz and Fz are accent-like dynamics - boost velocity and add slight duration reduction
                dynamicValue = Math.min(1.0, dynamicValue * 1.2);
            }
        }
        
        return dynamicValue;
    }

    async renderOffline(scoreData) {
        this.setBaseFrequency(scoreData.baseFrequency || 440);
        this.setTuningSystem(scoreData.tuningSystem || 'et');
        this.setKey(scoreData.keySignature || 'C');
        
        // 1. Build Timeline
        const trebleEvents = this._buildStaffTimeline(scoreData.notes || [], 'treble');
        const bassEvents = this._buildStaffTimeline(scoreData.notesBass || [], 'bass');
        const allEvents = [...trebleEvents, ...bassEvents];
        allEvents.sort((a, b) => a.startTime - b.startTime);

        // 2. Calculate Duration
        let maxEndTime = 0;
        allEvents.forEach(e => {
            if (e.startTime + e.duration > maxEndTime) maxEndTime = e.startTime + e.duration;
        });
        
        const secondsPerBeat = 60 / scoreData.tempo;
        const totalDuration = (maxEndTime * secondsPerBeat) + 3.0; // Tail

        // 3. Setup Offline Context
        const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * 44100), 44100);
        const { masterGain } = this._setupAudioGraph(offlineCtx);
        
        // 4. Schedule
        allEvents.forEach(event => {
            const startTime = 0.1 + (event.startTime * secondsPerBeat);
            const durationSec = event.duration * secondsPerBeat;
            const dynamicGain = this._calculateDynamic(event.index, event.staff, scoreData);
            
            let articulation = 'normal';
            if (event.note.isSlurred) articulation = 'legato';
            else if (event.note.isStaccato) articulation = 'staccato';
            else if (event.note.isMarcato) articulation = 'marcato';
            else if (event.note.isAccent) articulation = 'accent';

            event.note.keys.forEach(key => {
                const freq = this.frequencyFromNote(key);
                this.scheduleTone(offlineCtx, masterGain, freq, durationSec, startTime, articulation, dynamicGain, scoreData.instrument || 'piano');
            });
        });

        // 5. Render
        const renderedBuffer = await offlineCtx.startRendering();
        return this._bufferToWav(renderedBuffer);
    }

    _bufferToWav(abuffer) {
        const numOfChan = abuffer.numberOfChannels;
        const length = abuffer.length * numOfChan * 2 + 44;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        let pos = 0;

        const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
        const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };

        // Header
        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8);
        setUint32(0x45564157); // "WAVE"
        setUint32(0x20746d66); // "fmt "
        setUint32(16);
        setUint16(1); // PCM
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * 2 * numOfChan);
        setUint16(numOfChan * 2);
        setUint16(16);
        setUint32(0x61746164); // "data"
        setUint32(length - pos - 4);

        // Data
        const channels = [];
        for(let i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

        let offset = 44;
        for(let i = 0; i < abuffer.length; i++) {
            for(let ch = 0; ch < numOfChan; ch++) {
                let sample = Math.max(-1, Math.min(1, channels[ch][i]));
                sample = (0.5 + (sample < 0 ? sample * 32768 : sample * 32767))|0;
                view.setInt16(offset, sample, true);
                offset += 2;
            }
        }

        return new Blob([buffer], {type: "audio/wav"});
    }
    
    _getNoteDurationInBeats(note) {
        let beatMultiplier = 1;
        let durChar = note.duration.replace('r', '').replace('d', '');
        let isDotted = note.duration.includes('d');
        let isTriplet = note.isTriplet || false;

        if (durChar === 'w') beatMultiplier = 4;
        else if (durChar === 'h') beatMultiplier = 2;
        else if (durChar === 'q') beatMultiplier = 1;
        else if (durChar === '8') beatMultiplier = 0.5;
        else if (durChar === '16') beatMultiplier = 0.25;
        else if (durChar === '32') beatMultiplier = 0.125;
        else if (durChar === '64') beatMultiplier = 0.0625;
        else if (durChar === '128') beatMultiplier = 0.03125;

        if (isDotted) beatMultiplier *= 1.5;
        if (isTriplet) beatMultiplier *= (2/3);
        
        return beatMultiplier;
    }

    stop() {
        // Stop all active oscillators immediately to clear buffer
        this.activeNodes.forEach(node => {
            node.osc.forEach(o => {
                try { o.stop(); } catch(e) {}
            });
            // Also mute feedback/envelope gains immediately
            if (node.gain) {
                try {
                    node.gain.gain.cancelScheduledValues(this.ctx.currentTime);
                    node.gain.gain.setValueAtTime(0, this.ctx.currentTime);
                } catch(e) {}
            }
        });
        this.activeNodes = [];
        this.visualQueue = [];
        
        this.isPlaying = false;
        
        // Immediate fade out to silence
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.05);

        // Restore volume for manual play handled in playTone
    }
}