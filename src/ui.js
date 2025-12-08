import { Exporter } from './exporter.js';
import { Midi } from 'https://esm.sh/@tonejs/midi@2.0.28';

export class UI {
    constructor(state, audio, renderer, room) {
        this.state = state;
        this.audio = audio;
        this.renderer = renderer;
        this.room = room; // WebsimSocket

        this.selectedDuration = 'q'; // Default quarter
        this.isRestMode = false;
        this.isChordMode = false;
        this.isDottedMode = false;
        this.isTripletMode = false;
        this.isMetronomeOn = false;
        
        // Input state
        this.currentOctave = 4;
        this.pendingHairpin = null; // Track hairpin creation state

        // Track last selection for selection-audition
        this.lastSelectedIndex = -1;
        this.lastSelectedStaff = null;

        this.pianoContainer = document.getElementById('piano');

        // Keyboard focus routing: 'score' or 'menu'
        this.keyboardMode = 'score';
        this.activeMenuElement = null;

        this.setupPiano();
        this.setupCanvasInteraction();
        this.setupControls();
        this.setupKeyboard();
        this.setupLibrary(); // New
        this.setupMidi();
        this.setupErrorHandling();
        
        // Track for auto-scroll
        this.prevNoteCount = 0;
    }

    setupErrorHandling() {
        const modal = document.getElementById('error-modal');
        const msgBox = document.getElementById('error-msg');
        const btnCopy = document.getElementById('btn-error-copy');
        const btnDismiss = document.getElementById('btn-error-dismiss');

        const showError = (error) => {
            if (modal) {
                msgBox.textContent = error.toString() + "\n" + (error.stack || "");
                modal.classList.remove('hidden');
            }
        };

        // Listen for internal errors
        window.addEventListener('litescore-error', (e) => {
            showError(e.detail);
        });

        // Listen for global unhandled errors
        window.addEventListener('error', (e) => {
            showError(e.error || e.message);
        });

        if (btnDismiss) {
            btnDismiss.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }

        if (btnCopy) {
            btnCopy.addEventListener('click', () => {
                navigator.clipboard.writeText(msgBox.textContent).then(() => {
                    const originalText = btnCopy.textContent;
                    btnCopy.textContent = "Copied!";
                    setTimeout(() => btnCopy.textContent = originalText, 1500);
                });
            });
        }
        
        // Prevent clicking backdrop to close for errors (force explicit dismiss)
        // We do strictly nothing on backdrop click here.
    }

    setupControls() {
        // Voice Management
        const btnAddVoice = document.getElementById('btn-add-voice');
        const btnRemoveVoice = document.getElementById('btn-remove-voice');
        const voiceSelector = document.getElementById('voice-selector');

        if (btnAddVoice) {
            btnAddVoice.addEventListener('click', () => {
                const voice = this.state.addVoice(this.state.activeStaff);
                this.updateVoiceSelector();
                this.showTempToast(`Added ${voice.name}`);
            });
        }

        if (btnRemoveVoice) {
            btnRemoveVoice.addEventListener('click', () => {
                const activeVoice = this.state.getActiveVoice();
                if (activeVoice && this.state.data.voices.length > 1) {
                    this.state.removeVoice(activeVoice.id);
                    this.updateVoiceSelector();
                    this.showTempToast(`Removed ${activeVoice.name}`);
                }
            });
        }

        if (voiceSelector) {
            voiceSelector.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val === 'base') {
                    // Select base Voice 1 (staff notes)
                    this.state.setActiveVoice(null);
                    this.showTempToast('Voice 1 (base staff) selected');
                } else {
                    const id = parseInt(val, 10);
                    if (!Number.isNaN(id)) {
                        this.state.setActiveVoice(id);
                        const voice = (this.state.data.voices || []).find(v => v.id === id);
                        this.showTempToast(voice ? `${voice.name} selected` : 'Voice selected');
                    }
                }
            });
        }

        // Voice / Part Toggle
        const btnTreble = document.getElementById('btn-part-treble');
        const btnBass = document.getElementById('btn-part-bass');
        
        if (btnTreble && btnBass) {
            btnTreble.addEventListener('click', () => {
                this.state.setActiveStaff('treble');
                btnTreble.classList.add('active');
                btnTreble.style.background = 'white';
                btnBass.classList.remove('active');
                btnBass.style.background = 'transparent';
                this.currentOctave = 4; // Reset octave convenient for treble
            });
            
            btnBass.addEventListener('click', () => {
                this.state.setActiveStaff('bass');
                btnBass.classList.add('active');
                btnBass.style.background = 'white';
                btnTreble.classList.remove('active');
                btnTreble.style.background = 'transparent';
                this.currentOctave = 2; // Reset octave convenient for bass
            });
        }

        // Duration Buttons
        document.querySelectorAll('.dur-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;

                if (target.id === 'btn-rest') {
                    this.isRestMode = !this.isRestMode;
                    // Disable chord mode if rest is on (simplification)
                    if(this.isRestMode) {
                        this.isChordMode = false;
                        document.getElementById('btn-chord').classList.remove('active');
                    }
                    target.classList.toggle('active', this.isRestMode);
                    return;
                }

                if (target.id === 'btn-dot') {
                    // Toggle mode
                    this.isDottedMode = !this.isDottedMode;
                    target.classList.toggle('active', this.isDottedMode);
                    // Also toggle for selected note if any
                    this.state.toggleNoteDotted();
                    return;
                }

                if (target.id === 'btn-triplet') {
                    this.isTripletMode = !this.isTripletMode;
                    target.classList.toggle('active', this.isTripletMode);
                    return;
                }

                if (target.id === 'btn-tie') {
                    this.state.toggleTie();
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-slur') {
                    this.state.toggleSlur();
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-chord') {
                    this.isChordMode = !this.isChordMode;
                    // Disable rest mode if chord is on
                    if(this.isChordMode) {
                        this.isRestMode = false;
                        document.getElementById('btn-rest').classList.remove('active');
                    }
                    target.classList.toggle('active', this.isChordMode);
                    return;
                }

                // Renamed from btn-undo to btn-delete in HTML
                if (target.id === 'btn-delete') {
                    this.state.deleteSelectedNote();
                    return;
                }

                if (target.id === 'btn-copy') {
                    this.state.copySelectedNote();
                    // Visual feedback
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-paste') {
                    this.state.pasteNote();
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-en') {
                    this.state.toggleEnharmonic();
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-trans-up') {
                    this.state.transposeSelection(1);
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-trans-down') {
                    this.state.transposeSelection(-1);
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-prev') {
                    this.state.selectPrev();
                    return;
                }

                if (target.id === 'btn-next') {
                    this.state.selectNext();
                    return;
                }

                if (target.dataset.duration) {
                    this.selectedDuration = target.dataset.duration;
                    // Update visual active state
                    document.querySelectorAll('.dur-btn[data-duration]').forEach(b => b.classList.remove('active'));
                    target.classList.add('active');
                    
                    // Update selected note if any
                    this.state.changeNoteDuration(this.selectedDuration);
                }
                
                // Dynamics
                if (target.dataset.dynamic) {
                    this.state.setDynamic(target.dataset.dynamic);
                    // No sticky active state for dynamics (toggle logic in state)
                }

                if (target.id === 'btn-sfz') {
                    this.state.setDynamic('sfz');
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-fz') {
                    this.state.setDynamic('fz');
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-lyrics') {
                    this.promptForLyric();
                    return;
                }

                // Articulations
                if (target.id === 'btn-staccato') {
                    this.state.toggleStaccato();
                    return;
                }
                if (target.id === 'btn-accent') {
                    this.state.toggleAccent();
                    return;
                }
                if (target.id === 'btn-marcato') {
                    this.state.toggleMarcato();
                    return;
                }
                if (target.id === 'btn-tenuto') {
                    this.state.toggleTenuto();
                    return;
                }
                
                if (target.id === 'btn-fermata') {
                    this.state.toggleFermata();
                    target.classList.add('active');
                    setTimeout(() => target.classList.remove('active'), 200);
                    return;
                }

                if (target.id === 'btn-cresc' || target.id === 'btn-decresc') {
                    const type = target.id === 'btn-cresc' ? 'cresc' : 'decresc';
                    const score = this.state.getScore();
                    
                    // 1. If Range Selected -> Create immediately
                    if (score.selectedIndex !== -1 && score.selectedIndex !== score.selectionEndIndex) {
                        this.state.addHairpin(type);
                    } 
                    // 2. If Single Note Selected -> Enter "Targeting Mode"
                    else if (score.selectedIndex !== -1) {
                        if (this.pendingHairpin && this.pendingHairpin.type === type) {
                            // Toggle off if clicking same button
                            this.pendingHairpin = null;
                            target.classList.remove('active');
                            this.showTempToast("Cancelled");
                        } else {
                            // Start selection
                            this.pendingHairpin = { type: type, start: score.selectedIndex };
                            
                            // Visual feedback
                            document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
                            target.classList.add('active'); // Keep active until completion
                            
                            this.showTempToast(`Select end note for ${type === 'cresc' ? 'Cresc.' : 'Decresc.'}`);
                        }
                    } else {
                        this.showTempToast("Select a starting note first");
                    }
                    return;
                }
            });
        });

        // Metronome
        document.getElementById('btn-metro').addEventListener('click', (e) => {
            this.isMetronomeOn = !this.isMetronomeOn;
            e.currentTarget.classList.toggle('active', this.isMetronomeOn);
        });

        // --- Menu & File Operations ---
        const menuModal = document.getElementById('menu-modal');
        const btnMenu = document.getElementById('btn-menu');
        const btnMenuClose = document.getElementById('btn-menu-close');
        
        const toggleMenu = (show) => {
            if (show) menuModal.classList.remove('hidden');
            else menuModal.classList.add('hidden');
        };

        btnMenu.addEventListener('click', () => toggleMenu(true));
        btnMenuClose.addEventListener('click', () => toggleMenu(false));
        menuModal.querySelector('.modal-backdrop').addEventListener('click', () => toggleMenu(false));

        // 1. New (Clear)
        document.getElementById('btn-menu-new').addEventListener('click', () => {
            if(confirm("Create new score? Unsaved changes will be lost.")) {
                this.state.reset();
                toggleMenu(false);
                this.showTempToast("New score created");
            }
        });

        // 2. Save (JSON)
        document.getElementById('btn-menu-save').addEventListener('click', () => {
            const data = JSON.stringify(this.state.getScore(), null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `litescore_project_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toggleMenu(false);
            this.showTempToast("Project saved");
        });

        // 3. Open (JSON)
        const fileInput = document.getElementById('file-upload');
        document.getElementById('btn-menu-open').addEventListener('click', () => {
            fileInput.click();
        });
        
        // --- Library Logic ---
        document.getElementById('btn-menu-save-db').addEventListener('click', () => {
            this.saveToLibrary();
            toggleMenu(false);
        });

        document.getElementById('btn-menu-open-db').addEventListener('click', () => {
            this.openLibraryModal();
            toggleMenu(false);
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Check extension
            if (file.name.toLowerCase().endsWith('.mid') || file.name.toLowerCase().endsWith('.midi')) {
                this.loadMidiFile(file);
                toggleMenu(false);
                fileInput.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (this.state.loadData(data)) {
                        this.showTempToast("Project loaded");
                    } else {
                        alert("Error: Invalid project file.");
                    }
                } catch (err) {
                    console.error(err);
                    alert("Error parsing file.");
                }
                toggleMenu(false);
                fileInput.value = ''; // Reset
            };
            reader.readAsText(file);
        });

        // 4. Export (XML)
        document.getElementById('btn-menu-export-xml').addEventListener('click', () => {
            const xml = Exporter.generateMusicXML(this.state.getScore());
            this.downloadFile(xml, 'score.musicxml', 'text/xml');
            toggleMenu(false);
        });

        // 5. Export MIDI
        document.getElementById('btn-menu-export-midi').addEventListener('click', () => {
            const midiData = Exporter.generateMIDI(this.state.getScore());
            const a = document.createElement('a');
            a.href = midiData;
            a.download = 'score.mid';
            a.click();
            toggleMenu(false);
        });

        // 6. Export ABC
        document.getElementById('btn-menu-export-abc').addEventListener('click', () => {
            const abc = Exporter.generateABC(this.state.getScore());
            this.downloadFile(abc, 'score.abc', 'text/plain');
            toggleMenu(false);
        });
        
        // 7. Export WAV
        document.getElementById('btn-menu-export-wav').addEventListener('click', async () => {
            toggleMenu(false);
            this.showTempToast("Rendering audio... please wait");
            
            try {
                // Give UI a moment to update toast
                await new Promise(r => setTimeout(r, 100));
                
                const blob = await this.audio.renderOffline(this.state.getScore());
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'score.wav';
                a.click();
                URL.revokeObjectURL(url);
                this.showTempToast("Download started");
            } catch (e) {
                console.error(e);
                alert("Audio render failed: " + e.message);
            }
        });
        
        // History Controls
        document.getElementById('btn-undo-history').addEventListener('click', () => {
            this.state.undo();
        });

        document.getElementById('btn-redo-history').addEventListener('click', () => {
            this.state.redo();
        });

        // Settings Modal (Tempo & Time Signature)
        const settingsModal = document.getElementById('settings-modal');
        const btnSettings = document.getElementById('btn-settings');
        const btnModalClose = document.getElementById('btn-modal-close');
        
        // Tabs
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.add('hidden'));
                
                btn.classList.add('active');
                const tabId = `tab-${btn.dataset.tab}`;
                document.getElementById(tabId).classList.remove('hidden');
            });
        });

        const tempoSlider = document.getElementById('tempo-slider');
        const tempoVal = document.getElementById('tempo-val');
        const keySelect = document.getElementById('key-select');
        const instSelect = document.getElementById('inst-select');
        const baseFreqInput = document.getElementById('base-freq-input');
        const tuningSelect = document.getElementById('tuning-select');
        const fermataScaleInput = document.getElementById('fermata-scale-input');
        
        // Interface Settings
        const chkShowPiano = document.getElementById('chk-show-piano');
        const chkShowDur = document.getElementById('chk-show-durations');
        const chkShowDyn = document.getElementById('chk-show-dynamics');
        const chkShowEdit = document.getElementById('chk-show-edit-tools');
        
        const btnLayoutBeg = document.getElementById('btn-layout-beginner');
        const btnLayoutInt = document.getElementById('btn-layout-inter');
        const btnLayoutAdv = document.getElementById('btn-layout-adv');

        // New Toolbar Clef Control
        const toolbarClef = document.getElementById('toolbar-clef');
        if (toolbarClef) {
            toolbarClef.addEventListener('change', (e) => {
                this.state.setClef(e.target.value);
                // Return focus to canvas so keyboard shortcuts work? 
                toolbarClef.blur();
            });
        }

        // New Settings
        const barsInput = document.getElementById('bars-per-line');
        const chkHeaders = document.getElementById('chk-show-headers');
        const chkSingleLine = document.getElementById('chk-single-line');
        const chkShowNoteNames = document.getElementById('chk-show-note-names');

        // UI Toggles
        const toggleUI = (key, val) => {
            this.state.setUISetting(key, val);
            this.applyUISettings(this.state.getScore().ui);
        };
        
        chkShowPiano.addEventListener('change', (e) => toggleUI('showPiano', e.target.checked));
        chkShowDur.addEventListener('change', (e) => toggleUI('showDurationControls', e.target.checked));
        chkShowDyn.addEventListener('change', (e) => toggleUI('showDynamicsControls', e.target.checked));
        chkShowEdit.addEventListener('change', (e) => toggleUI('showEditTools', e.target.checked));

        // Presets
        btnLayoutBeg.addEventListener('click', () => {
             const settings = { showPiano: true, showDurationControls: true, showDynamicsControls: false, showEditTools: false };
             this.state.data.ui = settings;
             this.applyUISettings(settings);
             this.syncSettingsModal(settings);
        });
        btnLayoutInt.addEventListener('click', () => {
             const settings = { showPiano: true, showDurationControls: true, showDynamicsControls: true, showEditTools: false };
             this.state.data.ui = settings;
             this.applyUISettings(settings);
             this.syncSettingsModal(settings);
        });
        btnLayoutAdv.addEventListener('click', () => {
             const settings = { showPiano: true, showDurationControls: true, showDynamicsControls: true, showEditTools: true };
             this.state.data.ui = settings;
             this.applyUISettings(settings);
             this.syncSettingsModal(settings);
        });

        // Wiring listeners
        tempoSlider.addEventListener('input', (e) => {
            tempoVal.textContent = e.target.value;
            this.state.setTempo(e.target.value);
        });
        keySelect.addEventListener('change', (e) => this.state.setKeySignature(e.target.value));
        instSelect.addEventListener('change', (e) => this.state.setInstrument(e.target.value));
        baseFreqInput.addEventListener('change', (e) => this.state.setBaseFrequency(e.target.value));
        tuningSelect.addEventListener('change', (e) => this.state.setTuningSystem(e.target.value));
        fermataScaleInput.addEventListener('change', (e) => this.state.setFermataScale(e.target.value));
        barsInput.addEventListener('change', (e) => this.state.setBarsPerSystem(e.target.value));
        chkHeaders.addEventListener('change', (e) => this.state.setShowHeaders(e.target.checked));
        chkSingleLine.addEventListener('change', (e) => this.state.setSingleLine(e.target.checked));
        if (chkShowNoteNames) chkShowNoteNames.addEventListener('change', (e) => this.state.setShowNoteNames(e.target.checked));

        // Fermata Select Logic
        const selFermata = document.getElementById('sel-fermata');
        if (selFermata) {
            selFermata.addEventListener('change', (e) => {
                // If value is 'fermata', toggle it on. If empty, toggle off (if on).
                // State only has toggleFermata, so check current state.
                const score = this.state.getScore();
                if (score.selectedIndex !== -1) {
                    const notes = this.state._getActiveNotes(); // Access internal or check UI
                    // UI shouldn't access private methods ideally, but...
                    // Let's just use toggleFermata.
                    // Better: UI updates selection dropdown based on selected note.
                    // Here we just trigger toggle.
                    const val = e.target.value;
                    const note = notes[score.selectedIndex];
                    if (note) {
                        if ((val === 'fermata' && !note.isFermata) || (val === '' && note.isFermata)) {
                            this.state.toggleFermata();
                        }
                    }
                }
                // Blur to return focus
                selFermata.blur();
            });
        }

        btnSettings.addEventListener('click', () => {
            // Update values before showing
            const score = this.state.getScore();
            tempoSlider.value = score.tempo;
            tempoVal.textContent = score.tempo;
            keySelect.value = score.keySignature || 'C';
            instSelect.value = score.instrument || 'guitar';
            baseFreqInput.value = score.baseFrequency || 440;
            tuningSelect.value = score.tuningSystem || 'et';
            fermataScaleInput.value = score.fermataScale || 2.0;
            barsInput.value = score.barsPerSystem || 0;
            chkHeaders.checked = score.showHeaders !== false;
            chkSingleLine.checked = score.singleLine || false;
            if (chkShowNoteNames) chkShowNoteNames.checked = score.showNoteNames || false;
            
            this.syncSettingsModal(score.ui || {});

            settingsModal.classList.remove('hidden');
        });

        const closeModal = () => settingsModal.classList.add('hidden');
        btnModalClose.addEventListener('click', closeModal);
        settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);

        // Help Modal
        const helpModal = document.getElementById('help-modal');
        const btnHelp = document.getElementById('btn-help');
        const btnHelpClose = document.getElementById('btn-help-close');

        if (btnHelp && helpModal) {
            const toggleHelp = (show) => {
                if (show) helpModal.classList.remove('hidden');
                else helpModal.classList.add('hidden');
            };

            btnHelp.addEventListener('click', () => toggleHelp(true));
            if (btnHelpClose) btnHelpClose.addEventListener('click', () => toggleHelp(false));
            helpModal.querySelector('.modal-backdrop').addEventListener('click', () => toggleHelp(false));
        }

        // Transport
        document.getElementById('btn-play').addEventListener('click', () => {
            this.audio.resume(); // Ensure audio context is running
            
            // Determine start index from selection
            const score = this.state.getScore();
            let startIndex = score.selectedIndex;
            if (startIndex === -1 || startIndex >= score.notes.length) {
                startIndex = 0;
            }

            // Ensure audio engine has latest settings before play
            this.audio.setTuningSystem(score.tuningSystem || 'et');
            this.audio.setKey(score.keySignature || 'C');

            this.audio.playScore(
                score, 
                (index, duration, staff) => {
                    // Update cursor
                    const pos = this.renderer.getNotePosition(index, staff);
                    const cursor = document.getElementById('playback-cursor');
                    if (pos && cursor) {
                        cursor.style.display = 'block';
                        cursor.style.left = (pos.x + 20) + 'px'; // +20 padding offset
                        
                        // Check for Grand Staff (Bass presence) to extend cursor
                        const hasBass = (score.notesBass && score.notesBass.length > 0) || score.activeStaff === 'bass';
                        
                        if (hasBass) {
                            // Span both staves: Treble starts at 40 relative to system, Bass ends approx 260
                            cursor.style.top = (pos.systemTop + 40) + 'px';
                            cursor.style.height = '220px';
                        } else {
                            // Single stave
                            cursor.style.top = pos.y + 'px'; 
                            cursor.style.height = '100px'; 
                        }
                        
                        // Auto-scroll
                        const wrapper = document.getElementById('canvas-wrapper');
                        const center = wrapper.clientWidth / 2;
                        
                        // Only scroll if we are somewhat outside the comfortable center zone
                        if (pos.x > wrapper.scrollLeft + wrapper.clientWidth - 50 || pos.x < wrapper.scrollLeft + 50) {
                           wrapper.scrollTo({ left: pos.x - center, behavior: 'smooth' });
                        }
                    }

                    // Piano Visual Feedback (Only for Treble notes for now, or match pitch)
                    // The note data comes from the specific staff
                    const notesArr = staff === 'bass' ? this.state.getScore().notesBass : this.state.getScore().notes;
                    const noteData = notesArr[index];
                    
                    if (noteData && !noteData.isRest) {
                        noteData.keys.forEach(key => {
                            const keyEl = this.pianoContainer.querySelector(`.key[data-note="${key}"]`);
                            if (keyEl) {
                                keyEl.classList.add('playing');
                                setTimeout(() => keyEl.classList.remove('playing'), duration * 1000);
                            }
                        });
                    }
                }, 
                () => {
                    // On Finish
                    const cursor = document.getElementById('playback-cursor');
                    if(cursor) cursor.style.display = 'none';
                },
                this.isMetronomeOn,
                startIndex
            );
        });

        document.getElementById('btn-stop').addEventListener('click', () => {
            this.audio.stop();
            const cursor = document.getElementById('playback-cursor');
            if(cursor) cursor.style.display = 'none';
            // Clear piano playing classes
            this.pianoContainer.querySelectorAll('.key.playing').forEach(k => k.classList.remove('playing'));
        });
    }

    update(data) {
        const btn = document.getElementById('btn-settings');
        if(btn) btn.textContent = data.timeSignature;

        // Update Toolbar Clef based on active selection
        const toolbarClef = document.getElementById('toolbar-clef');
        if (toolbarClef) {
            const activeClef = data.activeStaff === 'bass' ? (data.clefBass || 'bass') : (data.clef || 'treble');
            if (toolbarClef.value !== activeClef) {
                toolbarClef.value = activeClef;
            }
        }

        // Sync Audio Base Frequency
        this.audio.setBaseFrequency(data.baseFrequency || 440);
        this.audio.setTuningSystem(data.tuningSystem || 'et');
        this.audio.setKey(data.keySignature || 'C');

        // Auto-scroll to end if note added at the end
        if (data.notes.length > this.prevNoteCount && data.selectedIndex === -1) {
            this.scrollToEnd();
        } else if (data.selectedIndex !== -1) {
            // Update Dynamics UI feedback
            const note = (data.selectionVoiceId == null
                ? (data.activeStaff === 'bass' ? (data.notesBass || []) : (data.notes || []))
                : ((data.voices || []).find(v => v.id === data.selectionVoiceId)?.notes || [])
            )[data.selectedIndex];
            
            // Helper to update toggle buttons
            const updateBtn = (id, isActive) => {
                const el = document.getElementById(id);
                if (el) {
                     if (isActive) {
                        el.classList.add('active');
                        el.style.backgroundColor = 'var(--primary-color)';
                        el.style.color = 'white';
                     } else {
                        el.classList.remove('active');
                        el.style.backgroundColor = '';
                        el.style.color = '';
                     }
                }
            };

            // Dynamics
            document.querySelectorAll('button[data-dynamic]').forEach(btn => {
                const isActive = note && note.dynamic === btn.dataset.dynamic;
                if (isActive) {
                    btn.classList.add('active');
                    btn.style.backgroundColor = 'var(--primary-color)';
                    btn.style.color = 'white';
                } else {
                    btn.classList.remove('active');
                    btn.style.backgroundColor = '';
                    btn.style.color = '';
                }
            });

            updateBtn('btn-lyrics', note && !!note.lyric);
            updateBtn('btn-staccato', note && !!note.isStaccato);
            updateBtn('btn-accent', note && !!note.isAccent);
            updateBtn('btn-marcato', note && !!note.isMarcato);
            
            // Update Fermata button state
            updateBtn('btn-fermata', note && !!note.isFermata);
            
            // Ensure selected note is visible
            this.scrollToNote(data.selectedIndex);

            // Play selected note once on selection change (per staff & voice)
            const selStaff = data.activeStaff === 'bass' ? 'bass' : 'treble';
            const selVoiceId = data.selectionVoiceId ?? null;
            if (
                this.lastSelectedIndex !== data.selectedIndex ||
                this.lastSelectedStaff !== selStaff ||
                this.lastSelectedVoiceId !== selVoiceId
            ) {
                const notesArr =
                    selVoiceId == null
                        ? (selStaff === 'bass' ? (data.notesBass || []) : (data.notes || []))
                        : ((data.voices || []).find(v => v.id === selVoiceId)?.notes || []);
                const noteObj = notesArr[data.selectedIndex];
                if (noteObj && !noteObj.isRest && noteObj.keys && noteObj.keys.length > 0) {
                    const freq = this.audio.frequencyFromNote(noteObj.keys[0]);
                    this.audio.playTone(freq, 0.35, this.audio.ctx.currentTime, 'normal', 0.7);
                }
                this.lastSelectedIndex = data.selectedIndex;
                this.lastSelectedStaff = selStaff;
                this.lastSelectedVoiceId = selVoiceId;
            }
        } else {
            // Clear selection tracking when nothing is selected
            this.lastSelectedIndex = -1;
            this.lastSelectedStaff = null;
            this.lastSelectedVoiceId = null;
        }
        
        // Sync UI toggles
        if (data.ui) this.applyUISettings(data.ui);
        
        // Update Fermata Dropdown
        const selFermata = document.getElementById('sel-fermata');
        if (selFermata && data.selectedIndex !== -1) {
             const notes =
                 data.selectionVoiceId == null
                     ? (data.activeStaff === 'bass' ? data.notesBass : data.notes)
                     : ((data.voices || []).find(v => v.id === data.selectionVoiceId)?.notes);
             const note = notes ? notes[data.selectedIndex] : null;
             if (note) {
                 selFermata.value = note.isFermata ? 'fermata' : '';
             } else {
                 selFermata.value = '';
             }
        }

        this.prevNoteCount = data.notes.length;
    }
    
    syncSettingsModal(uiSettings) {
        if (!uiSettings) return;
        const chkShowPiano = document.getElementById('chk-show-piano');
        const chkShowDur = document.getElementById('chk-show-durations');
        const chkShowDyn = document.getElementById('chk-show-dynamics');
        const chkShowEdit = document.getElementById('chk-show-edit-tools');
        
        if(chkShowPiano) chkShowPiano.checked = uiSettings.showPiano !== false;
        if(chkShowDur) chkShowDur.checked = uiSettings.showDurationControls !== false;
        if(chkShowDyn) chkShowDyn.checked = uiSettings.showDynamicsControls !== false;
        if(chkShowEdit) chkShowEdit.checked = uiSettings.showEditTools !== false;
    }

    applyUISettings(ui) {
        if (!ui) return;
        const piano = document.getElementById('piano-container');
        const durBar = document.getElementById('duration-controls');
        // Dynamics bar is the parent of the duration bar? No, it's the second row.
        // In HTML, second row is <div class="duration-bar" style="border-top...
        // It doesn't have an ID. I should add one or select by sibling.
        // Let's select the second .duration-bar
        const bars = document.querySelectorAll('.duration-bar');
        const dynBar = bars[1]; // Second one
        
        // Edit tools: Copy, Paste, Transpose buttons. They are in Duration bar.
        // I'll just toggle specific buttons.
        const editBtns = document.querySelectorAll('#btn-copy, #btn-paste, #btn-trans-up, #btn-trans-down, #btn-delete, #btn-en');

        if (piano) piano.classList.toggle('ui-hidden', ui.showPiano === false);
        if (durBar) durBar.classList.toggle('ui-hidden', ui.showDurationControls === false);
        if (dynBar) dynBar.classList.toggle('ui-hidden', ui.showDynamicsControls === false);
        
        editBtns.forEach(btn => btn.classList.toggle('ui-hidden', ui.showEditTools === false));
        
        // Adjust main container height/padding if piano is hidden? 
        // Flex layout should handle it.
    }

    promptForLyric() {
        const score = this.state.getScore();
        if (score.selectedIndex === -1) {
            this.showTempToast("Select a note first");
            return;
        }
        const note = score.notes[score.selectedIndex];
        if (note.isRest) {
            this.showTempToast("Cannot add lyrics to rest");
            return;
        }

        const currentText = note.lyric || "";
        const text = prompt("Enter lyrics:", currentText);
        
        if (text !== null) {
            this.state.setLyric(text);
        }
    }

    async saveToLibrary() {
        const score = this.state.getScore();
        let name = score.name || "Untitled Score";
        
        // Simple prompt
        name = prompt("Enter score name:", name);
        if (!name) return; // Cancelled

        const saveData = {
            name: name,
            data: score // Store whole state object
        };

        try {
            if (score.id) {
                // Update existing
                await this.room.collection('score').update(score.id, saveData);
                this.state.data.name = name; // Update local state
                this.showTempToast("Score updated!");
            } else {
                // Create new
                const record = await this.room.collection('score').create(saveData);
                this.state.data.id = record.id;
                this.state.data.name = name;
                this.showTempToast("Score saved to library!");
            }
        } catch (e) {
            console.error(e);
            alert("Failed to save score: " + e.message);
        }
    }

    async openLibraryModal() {
        const modal = document.getElementById('library-modal');
        const list = document.getElementById('library-list');
        modal.classList.remove('hidden');
        list.innerHTML = '<p style="padding:10px; color:#666;">Loading scores...</p>';

        try {
            const records = await this.room.collection('score').getList();
            list.innerHTML = '';
            
            if (records.length === 0) {
                list.innerHTML = '<p style="padding:10px; color:#666;">No saved scores found.</p>';
                return;
            }

            records.forEach(rec => {
                const item = document.createElement('div');
                item.className = 'menu-item';
                item.style.justifyContent = 'space-between';
                
                const nameSpan = document.createElement('span');
                nameSpan.textContent = rec.name || "Untitled";
                nameSpan.style.flex = "1";
                nameSpan.style.cursor = "pointer";
                
                // Load Action
                nameSpan.addEventListener('click', () => {
                    if (confirm(`Load "${rec.name}"? Unsaved changes will be lost.`)) {
                        const data = rec.data;
                        if (this.state.loadData(data)) {
                            // Ensure ID is linked
                            this.state.data.id = rec.id;
                            this.state.data.name = rec.name;
                            this.showTempToast("Score loaded");
                            modal.classList.add('hidden');
                        }
                    }
                });

                // Delete Action
                const delBtn = document.createElement('button');
                delBtn.textContent = "🗑";
                delBtn.className = "icon-btn";
                delBtn.style.fontSize = "1rem";
                delBtn.style.padding = "4px";
                delBtn.title = "Delete";
                delBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${rec.name}" permanently?`)) {
                        await this.room.collection('score').delete(rec.id);
                        item.remove();
                        if (list.children.length === 0) {
                            list.innerHTML = '<p style="padding:10px; color:#666;">No saved scores found.</p>';
                        }
                    }
                });

                item.appendChild(nameSpan);
                item.appendChild(delBtn);
                list.appendChild(item);
            });

        } catch (e) {
            console.error(e);
            list.innerHTML = `<p style="color:red; padding:10px;">Error loading library: ${e.message}</p>`;
        }
    }

    setupLibrary() {
        // Just empty setup helper if needed later
    }

    scrollToNote(index) {
        setTimeout(() => {
            // Updated to handle multiple staves implicitly via search in renderer
            const pos = this.renderer.getNotePosition(index);
            const wrapper = document.getElementById('canvas-wrapper');
            if (pos && wrapper) {
                const visibleMin = wrapper.scrollLeft;
                const visibleMax = wrapper.scrollLeft + wrapper.clientWidth;
                
                // If off screen, scroll to center it
                if (pos.x < visibleMin || pos.x > visibleMax) {
                     wrapper.scrollTo({
                        left: pos.x - wrapper.clientWidth / 2,
                        behavior: 'smooth'
                    });
                }
            }
        }, 10);
    }

    scrollToEnd() {
        // Wait for render
        setTimeout(() => {
            const wrapper = document.getElementById('canvas-wrapper');
            if (wrapper) {
                wrapper.scrollTo({
                    left: wrapper.scrollWidth,
                    behavior: 'smooth'
                });
            }
        }, 10);
    }

    setupPiano() {
        // Generate keys from C1 to C8 (Standard 88 keys is A0-C8, but we'll stick to full octaves for simplicity or extend)
        // Let's do A0 to C8 to be proper.
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        let html = '';

        // A0, A#0, B0
        html += `<div class="key white" data-note="a/0">A0</div>`;
        html += `<div class="key black" data-note="a#/0"></div>`;
        html += `<div class="key white" data-note="b/0"></div>`;

        // Octaves 1 to 7
        for (let oct = 1; oct <= 7; oct++) {
            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                const isBlack = note.includes('#');
                const className = isBlack ? 'key black' : 'key white';
                // VexFlow format: c/4, c#/4
                const noteValue = `${note.toLowerCase()}/${oct}`; 

                // Show label on Cs
                const label = !isBlack && note === 'C' ? `C${oct}` : '';

                html += `<div class="${className}" data-note="${noteValue}">
                    ${label}
                </div>`;
            }
        }
        // Add final C8
        html += `<div class="key white" data-note="c/8">C8</div>`;

        this.pianoContainer.innerHTML = html;

        // Prevent Context Menu on Piano
        this.pianoContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });

        // Mouse Event
        let isMouseDown = false;
        let lastKey = null;
        let lastTouchTime = 0;

        const triggerKey = (target) => {
            // Prevent double firing if touch recently handled (mouse emulation)
            if (Date.now() - lastTouchTime < 500) return;

            if (target.classList.contains('key') && target !== lastKey) {
                this.handleNoteTrigger(target);
                lastKey = target;
            }
        };

        this.pianoContainer.addEventListener('mousemove', (e) => {
            if (isMouseDown) triggerKey(e.target);
        });

        document.addEventListener('mouseup', () => {
            isMouseDown = false;
            lastKey = null;
        });

        // Touch handling with scroll detection
        let touchStartX = 0;
        let touchStartY = 0;
        let isScrolling = false;

        this.pianoContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isScrolling = false;
        }, {passive: true});

        this.pianoContainer.addEventListener('touchmove', (e) => {
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > 10 || dy > 10) {
                isScrolling = true;
            }
        }, {passive: true});

        this.pianoContainer.addEventListener('touchend', (e) => {
            lastTouchTime = Date.now();
            if (!isScrolling) {
                // Prevent mouse emulation (double trigger)
                if (e.cancelable) e.preventDefault();

                // Determine target manually if needed, but event target is usually safe if no DOM removal
                let target = document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
                
                // Handle touches on children elements (e.g. text inside keys)
                if (target && !target.classList.contains('key')) {
                    target = target.closest('.key');
                }

                if (target && target.classList.contains('key')) {
                    this.handleNoteTrigger(target);
                }
            }
        });

        // Initial Scroll to Middle (C4)
        // Simple timeout to wait for render
        setTimeout(() => {
            const c4 = document.querySelector('div[data-note="c/4"]');
            if(c4) c4.scrollIntoView({ inline: "center", behavior: "smooth" });
        }, 100);
    }

    setupCanvasInteraction() {
        const wrapper = document.getElementById('canvas-wrapper');
        wrapper.addEventListener('click', (e) => {
            const target = e.target;
            if (target.tagName.toLowerCase() !== 'canvas') return;

            const rect = target.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const hit = this.renderer.getInteractionAt(x, y, target);
            const score = this.state.getScore();
            
            // Handle Shift Click for Range
            if (e.shiftKey && hit && hit.type === 'note') {
                this.state.selectNote(hit.index, hit.staff, true); // Extend = true
                return;
            }

            if (hit) {
                if (hit.type === 'note') {
                    // Check for Pending Hairpin Creation (only for base voice)
                    if (this.pendingHairpin && (hit.voiceId == null)) {
                        const start = this.pendingHairpin.start;
                        const end = hit.index;
                        
                        if (start === end) {
                            this.showTempToast("Select a different note to end");
                            return;
                        }

                        this.state.addHairpin(this.pendingHairpin.type, start, end);
                        
                        // Cleanup
                        const btnId = this.pendingHairpin.type === 'cresc' ? 'btn-cresc' : 'btn-decresc';
                        const btn = document.getElementById(btnId);
                        if(btn) btn.classList.remove('active');
                        
                        this.pendingHairpin = null;
                        this.showTempToast("Hairpin created");
                        return;
                    }

                    // Standard selection
                    // Pass staff & voice info to enable correct activeStaff switching
                    this.state.selectNote(hit.index, hit.staff, false, hit.voiceId ?? null);
                } else if (hit.type === 'tie') {
                    this.state.selectTie(hit.index, hit.staff);
                } else if (hit.type === 'slur') {
                    this.state.selectSlur(hit.index, hit.staff);
                } else if (hit.type === 'hairpin') {
                    this.state.selectHairpin(hit.start, hit.end, hit.staff);
                } else if (hit.type === 'clef') {
                    this.state.selectClef(hit.staff);
                    this.showTempToast(`Selected ${hit.staff === 'bass' ? 'Bass' : 'Treble'} Clef`);
                }
            } else {
                this.state.selectNote(-1);
            }
        });
    }

    setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            // FIX: Prevent double triggers on key hold
            if (e.repeat) return;

            // Ignore if in input field (if any exist later)
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            // --- Keyboard Note Input ---
            
            // Octave Shifting ([ and ])
            if (e.key === '[') {
                this.currentOctave = Math.max(0, this.currentOctave - 1);
                this.showTempToast(`Octave: ${this.currentOctave}`);
                return;
            }
            if (e.key === ']') {
                this.currentOctave = Math.min(8, this.currentOctave + 1);
                this.showTempToast(`Octave: ${this.currentOctave}`);
                return;
            }

            // Note Names (a-g)
            if (/^[a-g]$/i.test(e.key) && !e.ctrlKey && !e.metaKey) {
                const noteChar = e.key.toLowerCase();
                // Construct note, e.g. "c/4"
                const note = `${noteChar}/${this.currentOctave}`;
                this.triggerNote(note);
                return;
            }

            // Duration Shortcuts (1-5)
            // 1: Whole, 2: Half, 3: Quarter, 4: 8th, 5: 16th
            if (/^[1-5]$/.test(e.key)) {
                const map = { '1': 'w', '2': 'h', '3': 'q', '4': '8', '5': '16' };
                const btn = document.querySelector(`.dur-btn[data-duration="${map[e.key]}"]`);
                if (btn) btn.click();
                return;
            }

            // Toggles
            if (e.key === '.') {
                document.getElementById('btn-dot').click();
                return;
            }
            if (e.key.toLowerCase() === 't') {
                document.getElementById('btn-triplet').click();
                return;
            }
            if (e.key.toLowerCase() === 'r') {
                document.getElementById('btn-rest').click();
                return;
            }
            if (e.key.toLowerCase() === 'm') {
                document.getElementById('btn-metro').click();
                return;
            }
            
            // --- Existing Shortcuts ---

            // Undo/Redo
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.state.redo();
                } else {
                    this.state.undo();
                }
                return;
            }
            // Redo standard (Ctrl+Y)
            if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
                e.preventDefault();
                this.state.redo();
                return;
            }

            // Copy/Paste
            if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
                this.state.copySelectedNote();
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
                this.state.pasteNote();
                return;
            }

            // Navigation
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.state.selectPrev(e.shiftKey); // Pass shift for extend
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.state.selectNext(e.shiftKey); // Pass shift for extend
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.state.transposeSelection(1);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.state.transposeSelection(-1);
                return;
            }

            // Playback
            if (e.code === 'Space') {
                e.preventDefault();
                const btnPlay = document.getElementById('btn-play');
                const btnStop = document.getElementById('btn-stop');
                if (this.audio.isPlaying) {
                    btnStop.click();
                } else {
                    btnPlay.click();
                }
                return;
            }

            // Deletion
            if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                this.state.deleteSelectedNote();
                return;
            }

            // Shortcuts for durations (optional polish)
            // 1-5 keys mapping to duration? Maybe later.
        });
    }

    async setupMidi() {
        if (!navigator.requestMIDIAccess) return; 

        const midiSelect = document.getElementById('midi-input');
        if (!midiSelect) return;

        try {
            this.midiAccess = await navigator.requestMIDIAccess();
        } catch (e) {
            console.warn("MIDI Access failed", e);
            return;
        }

        const updateInputs = () => {
            // Keep current selection if possible
            const currentVal = midiSelect.value;
            midiSelect.innerHTML = '<option value="">None</option>';
            
            for (let input of this.midiAccess.inputs.values()) {
                const opt = document.createElement('option');
                opt.value = input.id;
                opt.text = input.name || `MIDI Input ${input.id}`;
                midiSelect.appendChild(opt);
            }

            if (currentVal && [...midiSelect.options].some(o => o.value === currentVal)) {
                midiSelect.value = currentVal;
            }
        };

        updateInputs();
        this.midiAccess.onstatechange = updateInputs;

        midiSelect.addEventListener('change', (e) => {
             if (this.currentMidiInput) {
                 this.currentMidiInput.onmidimessage = null;
             }
             const id = e.target.value;
             if (!id) {
                 this.currentMidiInput = null;
                 return;
             }
             this.currentMidiInput = this.midiAccess.inputs.get(id);
             if (this.currentMidiInput) {
                 this.currentMidiInput.onmidimessage = this.handleMidiMessage.bind(this);
             }
        });
    }

    handleMidiMessage(msg) {
        const [status, data1, data2] = msg.data;
        const command = status >> 4;
        
        // Note On = 9
        // Some devices send Note On with Velocity 0 for Note Off. We check data2 > 0.
        if (command === 9 && data2 > 0) {
            const noteVal = data1;
            const notes = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
            
            // MIDI 60 = C4
            const octave = Math.floor(noteVal / 12) - 1;
            const noteIdx = noteVal % 12;
            
            // Only support reasonable range to prevent rendering glitches
            if (octave >= 0 && octave <= 8) {
                const noteStr = `${notes[noteIdx]}/${octave}`;
                this.triggerNote(noteStr);
            }
        }
    }

    triggerNote(note) {
        // 1. Audio (immediate audition)
        if (this.audio.ctx.state === 'suspended') {
            this.audio.ctx.resume();
        }
        try {
            const freq = this.audio.frequencyFromNote(note);
            this.audio.playTone(freq, 0.3, this.audio.ctx.currentTime, 'normal', 0.7);
        } catch (e) {
            console.warn('Preview audio failed', e);
        }
        
        const activeVoice = this.state.getActiveVoice();
        if (activeVoice && this.state.data.voices.length > 0) {
            this.state.addNoteToVoice(activeVoice.id, note, this.selectedDuration, {
                isRest: this.isRestMode,
                isTriplet: this.isTripletMode
            });
        } else {
            // Fallback to legacy behavior for compatibility
            if (this.isChordMode) {
                this.state.addPitchToChord(note);
            } else {
                this.state.addNote(note, this.selectedDuration, {
                    isRest: this.isRestMode,
                    isTriplet: this.isTripletMode
                });
            }
        }

        // 2. Visual Feedback (Piano)
        const keyEl = this.pianoContainer.querySelector(`.key[data-note="${note}"]`);
        if (keyEl) {
            keyEl.classList.add('playing');
            setTimeout(() => keyEl.classList.remove('playing'), 150);
            
            // Auto-scroll piano if needed
            if (!this._isElementInViewport(keyEl, this.pianoContainer)) {
                keyEl.scrollIntoView({ inline: "center", behavior: "smooth" });
            }
        }
    }

    handleNoteTrigger(target) {
        const note = target.dataset.note;
        if (note) {
            this.triggerNote(note);
        }
    }

    showTempToast(msg) {
        // Simple visual feedback for non-ui interactions
        let toast = document.getElementById('temp-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'temp-toast';
            toast.style.position = 'fixed';
            toast.style.bottom = '160px'; // Above piano
            toast.style.left = '50%';
            toast.style.transform = 'translateX(-50%)';
            toast.style.background = 'rgba(0,0,0,0.7)';
            toast.style.color = 'white';
            toast.style.padding = '8px 16px';
            toast.style.borderRadius = '20px';
            toast.style.fontSize = '14px';
            toast.style.pointerEvents = 'none';
            toast.style.transition = 'opacity 0.3s';
            toast.style.zIndex = '2000';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.opacity = '1';
        
        if (this._toastTimeout) clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            toast.style.opacity = '0';
        }, 1000);
    }

    downloadFile(content, filename, type) {
        const blob = new Blob([content], { type: type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    _isElementInViewport(el, container) {
        const elRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return (
            elRect.left >= containerRect.left &&
            elRect.right <= containerRect.right
        );
    }

    async loadMidiFile(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const midi = new Midi(arrayBuffer);
            
            // Basic extraction
            const bpm = midi.header.tempos.length > 0 ? Math.round(midi.header.tempos[0].bpm) : 120;
            const timeSigRaw = midi.header.timeSignatures.length > 0 ? midi.header.timeSignatures[0].timeSignature : [4, 4];
            const timeSig = `${timeSigRaw[0]}/${timeSigRaw[1]}`;
            
            // Find a track with notes
            const track = midi.tracks.find(t => t.notes.length > 0);
            if (!track) {
                alert("No notes found in MIDI file.");
                return;
            }

            const notes = [];
            let lastTime = 0;
            const secondsPerBeat = 60 / bpm;

            const quantizeBeats = (sec) => {
                const b = sec / secondsPerBeat;
                // Round to nearest 0.25 (16th)
                return Math.max(0.25, Math.round(b * 4) / 4);
            };

            // Helper to decompose duration into standard values
            const generateRests = (beats) => {
                const generated = [];
                let remaining = beats;
                const options = [
                     { val: 4, code: 'w' }, { val: 3, code: 'hd' }, { val: 2, code: 'h' },
                     { val: 1.5, code: 'qd' }, { val: 1, code: 'q' }, { val: 0.75, code: '8d' },
                     { val: 0.5, code: '8' }, { val: 0.25, code: '16' }
                ];
                
                while (remaining >= 0.25) { 
                    const match = options.find(o => o.val <= remaining + 0.005);
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
            };

            const getBestDurationCode = (beats) => {
                 const options = [
                     { val: 4, code: 'w' }, { val: 3, code: 'hd' }, { val: 2, code: 'h' },
                     { val: 1.5, code: 'qd' }, { val: 1, code: 'q' }, { val: 0.75, code: '8d' },
                     { val: 0.5, code: '8' }, { val: 0.25, code: '16' }
                ];
                // Find closest
                const match = options.reduce((prev, curr) => 
                    Math.abs(curr.val - beats) < Math.abs(prev.val - beats) ? curr : prev
                );
                return match.code;
            };

            for (const n of track.notes) {
                // Check for gap (rest)
                const gap = n.time - lastTime;
                const gapBeats = quantizeBeats(gap);
                
                if (gapBeats >= 0.25) {
                    const rests = generateRests(gapBeats);
                    notes.push(...rests);
                }

                const durBeats = quantizeBeats(n.duration);
                // Convert MIDI note number to VexFlow key
                const noteName = n.name.toLowerCase().replace(/(\d+)/, '/$1');
                
                notes.push({
                    keys: [noteName],
                    duration: getBestDurationCode(durBeats),
                    isRest: false
                });

                lastTime = n.time + n.duration;
            }

            const scoreData = {
                tempo: bpm,
                timeSignature: timeSig,
                keySignature: 'C', 
                clef: 'treble',
                instrument: 'piano',
                notes: notes,
                selectedIndex: -1
            };

            this.state.loadData(scoreData);
            this.showTempToast("MIDI Imported");

        } catch (e) {
            console.error(e);
            alert("Failed to parse MIDI file.");
        }
    }

    updateVoiceSelector() {
        const voiceSelector = document.getElementById('voice-selector');
        if (!voiceSelector) return;

        voiceSelector.innerHTML = '';

        // Always include base staff as "Voice 1"
        const baseOption = document.createElement('option');
        baseOption.value = 'base';
        baseOption.textContent = 'Voice 1';
        voiceSelector.appendChild(baseOption);

        const { voices, activeVoiceId } = this.state.data;

        // Extra voices (2, 3, ...)
        if (Array.isArray(voices)) {
            voices.forEach((voice) => {
                const option = document.createElement('option');
                option.value = String(voice.id);
                option.textContent = voice.name;
                voiceSelector.appendChild(option);
            });
        }

        // Select current active voice in dropdown
        if (activeVoiceId === null || activeVoiceId === undefined) {
            baseOption.selected = true;
        } else {
            const selectedOption = [...voiceSelector.options].find(
                opt => opt.value === String(activeVoiceId)
            );
            if (selectedOption) selectedOption.selected = true;
        }
    }
}