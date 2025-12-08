import { Factory, Beam, Renderer, StaveNote, Accidental, Dot, Tuplet, StaveTie, Curve, Barline, Annotation, Articulation, StaveHairpin, Modifier, Fraction, StaveConnector } from 'vexflow';
import * as Vex from 'vexflow';

export class ScoreRenderer {
    constructor(elementId) {
        this.container = document.getElementById(elementId);
        this.notePositions = [];
        this.modifierPositions = [];
        this.clefPositions = []; // Track clefs
    }

    init() {
        // No-op
    }

    render(scoreData) {
        this.container.innerHTML = '';
        this.notePositions = [];
        this.modifierPositions = [];
        this.clefPositions = []; // Track clefs
        
        // Handle Single Line Mode class
        if (scoreData.singleLine) {
            this.container.classList.add('single-line');
        } else {
            this.container.classList.remove('single-line');
        }

        // Add Playback Cursor Element
        const cursor = document.createElement('div');
        cursor.id = 'playback-cursor';
        this.container.appendChild(cursor);

        try {
            // Check if we need Grand Staff (if bass notes exist or user active on bass)
            const showBass = scoreData.activeStaff === 'bass' || (scoreData.notesBass && scoreData.notesBass.length > 0);

            // Prepare Measures for Treble
            const trebleNotes = this.createVexFlowNotes(scoreData.notes, scoreData, 'treble');
            const trebleMeasures = this.groupNotesIntoMeasures(trebleNotes, scoreData.notes || [], scoreData);

            // Prepare Measures for Bass
            let bassMeasures = [];
            if (showBass) {
                // If bass is empty but shown, fill with whole rest placeholder?
                // Actually groupGroups... handles empty?
                let rawBass = scoreData.notesBass || [];
                // If completely empty, maybe add a whole rest if treble has content?
                // For MVP, just render what we have.
                const bassNotes = this.createVexFlowNotes(rawBass, scoreData, 'bass');
                bassMeasures = this.groupNotesIntoMeasures(bassNotes, rawBass, scoreData);
            }

            // Handle voices if polyphony is enabled
            let voiceMeasuresData = [];
            if (scoreData.voices && scoreData.voices.length > 0) {
                scoreData.voices.forEach((voice) => {
                    if (voice.notes && voice.notes.length > 0) {
                        const voiceNotes = this.createVexFlowNotes(voice.notes, scoreData, voice.staff, voice);
                        const voiceMeas = this.groupNotesIntoMeasures(voiceNotes, voice.notes, scoreData);
                        voiceMeasuresData.push({ measures: voiceMeas, voice });
                    }
                });
            }

            // Responsive Layout
            const containerWidth = scoreData.singleLine ? 999999 : (this.container.clientWidth || window.innerWidth);
            const availableWidth = containerWidth - 40; 
            
            let currentSystemMeasures = []; // Array of { treble: Measure, bass: Measure }
            let currentSystemWidth = 0;
            let currentY = 0;
            const systemHeight = showBass ? 320 : 200; // Taller for Grand Staff and low notes

            // Determine max measures across all voices and main staves
            let maxMeasures = Math.max(trebleMeasures.length, bassMeasures.length);
            voiceMeasuresData.forEach(vm => {
                maxMeasures = Math.max(maxMeasures, vm.measures.length);
            });

            for (let i = 0; i < maxMeasures; i++) {
                const tm = trebleMeasures[i] || { notes: [], number: i + 1, width: 60 };
                const bm = bassMeasures[i] || { notes: [], number: i + 1, width: 60 };
                
                // Calculate width
                const tWidth = (tm.notes.length * 40) + 60;
                const bWidth = (bm.notes.length * 40) + 60;
                let width = Math.max(tWidth, bWidth);

                // Include voice widths
                voiceMeasuresData.forEach(vm => {
                    const vmMeas = vm.measures[i];
                    if (vmMeas && vmMeas.notes.length > 0) {
                        const vmWidth = (vmMeas.notes.length * 40) + 60;
                        width = Math.max(width, vmWidth);
                    }
                });

                tm.width = width;
                bm.width = width;

                let shouldBreak = false;
                
                if (scoreData.barsPerSystem > 0) {
                    if (currentSystemMeasures.length >= scoreData.barsPerSystem) {
                        shouldBreak = true;
                    }
                } else {
                    // Approximate measure width check
                    if (currentSystemWidth + width > availableWidth && currentSystemMeasures.length > 0) {
                        shouldBreak = true;
                    }
                }

                if (shouldBreak) {
                    this.renderSystem(currentSystemMeasures, scoreData, currentY, availableWidth, showBass, voiceMeasuresData);
                    currentY += systemHeight;
                    currentSystemMeasures = [];
                    currentSystemWidth = 0;
                }

                currentSystemMeasures.push({ treble: tm, bass: bm, number: i+1, width: width });
                currentSystemWidth += width;
            }

            // Render last system
            if (currentSystemMeasures.length > 0) {
                this.renderSystem(currentSystemMeasures, scoreData, currentY, availableWidth, showBass, voiceMeasuresData);
            }

        } catch (e) {
            console.error("Rendering error:", e);
            window.dispatchEvent(new CustomEvent('litescore-error', { detail: e }));
        }
    }

    createVexFlowNotes(notesData, scoreData, staffType, voice = null) {
        if (!notesData) return [];
        
        // Determine Clef for this staff
        const currentClef = staffType === 'bass' ? (scoreData.clefBass || 'bass') : (scoreData.clef || 'treble');

        return notesData.map((n, i) => {
            const note = new StaveNote({
                keys: n.isRest ? (staffType === 'bass' ? ["d/3"] : ["b/4"]) : n.keys,
                duration: n.duration, 
                clef: currentClef // Pass dynamic clef
            });

            if (n.duration.includes('d')) {
                Dot.buildAndAttach([note]);
            }

            // Articulations & Modifiers
            if (n.isStaccato) note.addModifier(new Articulation('a.').setPosition(Articulation.Position.BELOW));
            if (n.isAccent) note.addModifier(new Articulation('a>').setPosition(Articulation.Position.BELOW));
            if (n.isMarcato) note.addModifier(new Articulation('a^').setPosition(Articulation.Position.BELOW));
            if (n.isFermata) note.addModifier(new Articulation('a@a').setPosition(Articulation.Position.ABOVE));
            if (n.isTenuto) note.addModifier(new Articulation('a-').setPosition(Articulation.Position.BELOW));

            if (n.dynamic) {
                note.addModifier(new Annotation(n.dynamic)
                    .setFont("Times New Roman", 12, "bold italic")
                    .setVerticalJustification(Annotation.VerticalJustify.BOTTOM));
            }
            if (n.lyric) {
                note.addModifier(new Annotation(n.lyric)
                    .setFont("Arial", 11, "")
                    .setVerticalJustification(Annotation.VerticalJustify.BOTTOM));
            }

            if (scoreData.showNoteNames) {
                n.keys.forEach(key => {
                    const [step, oct] = key.split('/');
                    const label = step.charAt(0).toUpperCase() + step.slice(1) + oct;
                    // Increased font size and used sans-serif for better visibility
                    note.addModifier(new Annotation(label)
                        .setFont("sans-serif", 11, "bold")
                        .setVerticalJustification(Annotation.VerticalJustify.BOTTOM));
                });
            }

            // Voice color for polyphony (secondary voices only)
            if (voice && voice.color) {
                note.setStyle({ fillStyle: voice.color, strokeStyle: voice.color });
            }

            // Selection Logic (Staff Aware)
            const selStart = Math.min(scoreData.selectedIndex, scoreData.selectionEndIndex);
            const selEnd = Math.max(scoreData.selectedIndex, scoreData.selectionEndIndex);
            const selectedVoiceId = scoreData.selectionVoiceId ?? null;
            const noteVoiceId = voice ? voice.id : null;
            
            // Only highlight if this note is on the active staff AND in the selected voice
            if (scoreData.activeStaff === staffType || (!scoreData.activeStaff && staffType === 'treble')) {
                const isSelected =
                    i >= selStart &&
                    i <= selEnd &&
                    (!scoreData.selectionType || scoreData.selectionType === 'note') &&
                    selectedVoiceId === noteVoiceId;
                if (isSelected) {
                    note.setStyle({ fillStyle: '#3b82f6', strokeStyle: '#3b82f6' });
                }
            }

            note.sourceIndex = i;
            note.staffType = staffType;
            note.voiceId = noteVoiceId;
            // Mark whether this came from a secondary voice (used only for debugging / future features)
            note.isSecondaryVoice = !!voice;
            return note;
        });
    }

    groupNotesIntoMeasures(allNotes, rawNotes, scoreData) {
        const timeSig = scoreData.timeSignature || "4/4";
        const [beatsPerMeasureStr, beatValueStr] = timeSig.split('/');
        const beatsPerMeasure = parseInt(beatsPerMeasureStr, 10);
        const beatValue = parseInt(beatValueStr, 10) || 4;
        const measureBeatCapacity = (beatsPerMeasure * 4) / beatValue;

        const measures = [];
        let currentNotes = [];
        let currentBeats = 0;
        let measureNumber = 1;

        let processed = 0;
        while (processed < allNotes.length) {
            const note = allNotes[processed];
            const rawNote = rawNotes[processed];
            const durString = rawNote.duration.replace('r','').replace('d', '');
            const isDotted = rawNote.duration.includes('d');
            const isTriplet = rawNote.isTriplet || false;

            let beats = 1;
            if(durString==='w') beats=4;
            if(durString==='h') beats=2;
            if(durString==='q') beats=1;
            if(durString==='8') beats=0.5;
            if(durString==='16') beats=0.25;
            if(durString==='32') beats=0.125;
            if(durString==='64') beats=0.0625;
            if(durString==='128') beats=0.03125;

            if (isDotted) beats *= 1.5;
            if (isTriplet) beats *= (2/3);

            // Floating point tolerance
            if (currentBeats + beats > measureBeatCapacity + 0.001 && currentBeats > 0) {
                measures.push({ notes: currentNotes, number: measureNumber });
                measureNumber++;
                currentNotes = [];
                currentBeats = 0;
            }

            currentNotes.push(note);
            currentBeats += beats;
            processed++;
        }
        
        if (currentNotes.length > 0) {
            measures.push({ notes: currentNotes, number: measureNumber });
        }

        return measures;
    }

    // Override renderSystem to handle Grand Staff
    renderSystem(measureGroups, scoreData, yPos, totalWidth, showBass, voiceMeasures) {
        const canvas = document.createElement('canvas');
        canvas.className = 'score-system';
        canvas.style.display = 'block';
        this.container.appendChild(canvas);

        const height = showBass ? 320 : 200;
        const vf = new Factory({
            renderer: { 
                elementId: canvas, 
                width: totalWidth, 
                height: height,
                backend: Renderer.Backends.CANVAS
            }
        });
        const context = vf.getContext();
        
        let currentX = 10;
        const notesInSystem = new Map(); // Key: 'treble_0', 'bass_5'
        const modifierPositions = [];
        this.clefPositions = []; // Track clefs
        
        // Polyphonic voice layout is prepared at a higher level and passed in;
        // no per-system re-declaration needed here.

        const timeSig = scoreData.timeSignature || "4/4";
        const [tsNum, tsDenom] = timeSig.split('/').map(n => parseInt(n));

        let fixedMeasureWidth = 0;
        if (scoreData.barsPerSystem > 0) {
             fixedMeasureWidth = (totalWidth - 20) / measureGroups.length;
        }

        // Adjusted Y positions for more clearance
        const trebleY = 40;
        const bassY = 160;

        measureGroups.forEach((group, idx) => {
            const isFirstInSystem = idx === 0;
            const isFirstInScore = group.number === 1;
            const showHeaders = isFirstInSystem && (scoreData.showHeaders || isFirstInScore);
            
            let extraWidth = showHeaders ? 60 : 0;
            let measureWidth = fixedMeasureWidth > 0 ? fixedMeasureWidth : group.width;
            
            // Treble Stave
            const staveTreble = vf.Stave({ x: currentX, y: trebleY, width: measureWidth + (fixedMeasureWidth > 0 ? 0 : extraWidth) });
            // Bass Stave
            let staveBass = null;
            if (showBass) {
                staveBass = vf.Stave({ x: currentX, y: bassY, width: measureWidth + (fixedMeasureWidth > 0 ? 0 : extraWidth) });
            }

            if (idx > 0) {
                staveTreble.setBegBarType(Barline.type.NONE);
                if (staveBass) staveBass.setBegBarType(Barline.type.NONE);
            }

            // Headers
            if (showHeaders || isFirstInScore) {
                // Use state clefs
                const tClef = scoreData.clef || 'treble';
                const bClef = scoreData.clefBass || 'bass';

                staveTreble.addClef(tClef);
                staveTreble.addKeySignature(scoreData.keySignature || 'C');
                staveTreble.addTimeSignature(scoreData.timeSignature);
                
                // Track Hitbox for Treble Clef
                this.clefPositions.push({
                    x: currentX,
                    y: yPos + trebleY,
                    w: 40, h: 80,
                    staff: 'treble',
                    canvas: canvas
                });

                // Highlight if selected
                if (scoreData.selectionType === 'clef' && (scoreData.activeStaff === 'treble' || !scoreData.activeStaff)) {
                    context.save();
                    context.fillStyle = 'rgba(59, 130, 246, 0.3)';
                    context.fillRect(currentX, trebleY, 30, 70); // Approximate
                    context.restore();
                }
                
                if (staveBass) {
                    staveBass.addClef(bClef);
                    staveBass.addKeySignature(scoreData.keySignature || 'C');
                    staveBass.addTimeSignature(scoreData.timeSignature);
                    
                    this.clefPositions.push({
                        x: currentX,
                        y: yPos + bassY,
                        w: 40, h: 80,
                        staff: 'bass',
                        canvas: canvas
                    });

                    if (scoreData.selectionType === 'clef' && scoreData.activeStaff === 'bass') {
                        context.save();
                        context.fillStyle = 'rgba(59, 130, 246, 0.3)';
                        context.fillRect(currentX, bassY, 30, 70);
                        context.restore();
                    }
                }
            }

            staveTreble.setMeasure(group.number);
            staveTreble.draw();
            if (staveBass) staveBass.draw();

            // Connectors
            if (isFirstInSystem && showBass) {
                const conn = new StaveConnector(staveTreble, staveBass);
                conn.setType(StaveConnector.type.BRACE);
                conn.setContext(context).draw();
                const conn2 = new StaveConnector(staveTreble, staveBass);
                conn2.setType(StaveConnector.type.SINGLE_LEFT);
                conn2.setContext(context).draw();
            } else if (showBass) {
                // Just a line for measures inside system
                // new StaveConnector(staveTreble, staveBass).setType(StaveConnector.type.SINGLE).setContext(context).draw();
                // Actually usually just barlines connect
            }
            if (showBass) {
                new StaveConnector(staveTreble, staveBass).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();
            }

            // Build voice sets for this measure & staff
            const trebleVoiceSpecs = [{
                notes: group.treble.notes,
                isMain: true,
                staff: 'treble',
                voiceId: null
            }];
            const bassVoiceSpecs = [{
                notes: group.bass.notes,
                isMain: true,
                staff: 'bass',
                voiceId: null
            }];

            voiceMeasures.forEach(vm => {
                const vmMeas = vm.measures[idx];
                if (!vmMeas || !vmMeas.notes || vmMeas.notes.length === 0) return;
                if (vm.voice.staff === 'treble') {
                    trebleVoiceSpecs.push({
                        notes: vmMeas.notes,
                        isMain: false,
                        staff: 'treble',
                        voiceId: vm.voice.id
                    });
                } else if (vm.voice.staff === 'bass') {
                    bassVoiceSpecs.push({
                        notes: vmMeas.notes,
                        isMain: false,
                        staff: 'bass',
                        voiceId: vm.voice.id
                    });
                }
            });

            const renderStaffVoices = (specs, stave, staffType) => {
                const nonEmptySpecs = specs.filter(s => s.notes && s.notes.length > 0);
                if (nonEmptySpecs.length === 0 || !stave) return;

                const vfVoices = [];
                const allBeams = [];
                let beamConfig = {};
                if (tsDenom === 8 && tsNum % 3 === 0) beamConfig = { groups: [new Fraction(3, 8)] };

                nonEmptySpecs.forEach(spec => {
                    const v = vf.Voice({ num_beats: tsNum, beat_value: tsDenom });
                    v.setStrict(false);
                    v.addTickables(spec.notes);
                    vfVoices.push(v);

                    const beams = Beam.generateBeams(spec.notes, beamConfig);
                    allBeams.push(...beams);
                });

                Accidental.applyAccidentals(vfVoices, scoreData.keySignature || "C");

                const formatWidth = measureWidth + (fixedMeasureWidth > 0 ? 0 : extraWidth) - (showHeaders ? 60 : 10);
                vf.Formatter().joinVoices(vfVoices).format(vfVoices, formatWidth);

                vfVoices.forEach(v => v.draw(context, stave));
                allBeams.forEach(b => b.setContext(context).draw());

                // Tuplets only from main voice notes, as before
                const mainSpec = nonEmptySpecs.find(s => s.isMain);
                if (mainSpec) {
                    let tripletGroup = [];
                    mainSpec.notes.forEach(note => {
                        const rawIndex = note.sourceIndex;
                        const srcArr = staffType === 'bass' ? scoreData.notesBass : scoreData.notes;
                        if (srcArr && srcArr[rawIndex] && srcArr[rawIndex].isTriplet) {
                            tripletGroup.push(note);
                        } else {
                            if (tripletGroup.length > 0) {
                                new Tuplet(tripletGroup).setContext(context).draw();
                                tripletGroup = [];
                            }
                        }
                    });
                    if (tripletGroup.length > 0) new Tuplet(tripletGroup).setContext(context).draw();

                    // Register positions only for main voice (keeps hit-testing consistent)
                    mainSpec.notes.forEach(note => {
                        notesInSystem.set(`${staffType}_${note.sourceIndex}`, note);
                    });

                    // Register hit-test positions for ALL voices so they are individually selectable
                    nonEmptySpecs.forEach(spec => {
                        spec.notes.forEach(note => {
                            const bbox = note.getBoundingBox();
                            this.notePositions.push({
                                index: note.sourceIndex,
                                staff: staffType,
                                voiceId: spec.voiceId ?? null,
                                x: note.getAbsoluteX(),
                                y: yPos + (staffType === 'bass' ? bassY : trebleY),
                                canvas: canvas,
                                systemY: yPos,
                                bbox: { x: bbox.getX(), y: bbox.getY(), w: bbox.getW(), h: bbox.getH() }
                            });
                        });
                    });
                }
            };

            // Render treble & bass staff with all voices layered
            renderStaffVoices(trebleVoiceSpecs, staveTreble, 'treble');
            if (showBass) {
                renderStaffVoices(bassVoiceSpecs, staveBass, 'bass');
            }
            
            currentX += measureWidth + (fixedMeasureWidth > 0 ? 0 : extraWidth);
        });

        // Modifiers (Ties/Slurs)
        // Need to loop over both lists
        const drawModifiers = (staffNotes, staffType, staffVoiceSpecs) => {
             if (!staffNotes) return;
             staffNotes.forEach((noteData, idx) => {
                const note = notesInSystem.get(`${staffType}_${idx}`);
                if (note) {
                    const nextNote = notesInSystem.get(`${staffType}_${idx + 1}`);
                    if (nextNote) {
                        if (noteData.isTied) {
                            const tie = new StaveTie({ first_note: note, last_note: nextNote });
                            // Highlight if selected AND on active staff
                            if (scoreData.activeStaff === staffType && scoreData.selectedIndex === idx && scoreData.selectionType === 'tie') {
                                tie.setStyle({ strokeStyle: '#3b82f6', fillStyle: '#3b82f6' });
                            }
                            tie.setContext(context).draw();
                            
                            this._addModifierHitBox(canvas, yPos + (staffType === 'bass' ? bassY : trebleY), note, nextNote, idx, 'tie', null, staffType);
                        }
                        if (noteData.isSlurred) {
                            const isSelected = scoreData.activeStaff === staffType && scoreData.selectedIndex === idx && scoreData.selectionType === 'slur';
                            const curve = new Curve(note, nextNote, {
                                thickness: isSelected ? 3 : 2,
                                position: Curve.Position.NEAR_TOP,
                                invert: true
                            });
                            if (isSelected) {
                                context.save();
                                context.setStrokeStyle('#3b82f6');
                                context.setFillStyle('#3b82f6');
                                curve.setContext(context).draw();
                                context.restore();
                            } else {
                                curve.setContext(context).draw();
                            }

                            this._addModifierHitBox(canvas, yPos + (staffType === 'bass' ? bassY : trebleY), note, nextNote, idx, 'slur', null, staffType);
                        }
                    }
                }
             });
        };

        drawModifiers(scoreData.notes, 'treble');
        if (showBass) drawModifiers(scoreData.notesBass, 'bass');

        // Hairpins
        if (scoreData.hairpins) {
            scoreData.hairpins.forEach(hp => {
                const hpStaff = hp.staff || 'treble';
                // Only draw if active or present
                if (hpStaff === 'bass' && !showBass) return;
                
                const firstNote = notesInSystem.get(`${hpStaff}_${hp.start}`);
                const lastNote = notesInSystem.get(`${hpStaff}_${hp.end}`);

                if (firstNote && lastNote) {
                    const type = hp.type === 'cresc' ? StaveHairpin.type.CRESC : StaveHairpin.type.DECRESC;
                    const hairpin = new StaveHairpin({ first_note: firstNote, last_note: lastNote }, type);
                    
                    hairpin.setContext(context);
                    hairpin.setPosition(Modifier.Position.BELOW);

                    const isSelected = scoreData.activeStaff === hpStaff && scoreData.selectionType === 'hairpin' && 
                                     scoreData.selectedIndex === hp.start && scoreData.selectionEndIndex === hp.end;

                    if (isSelected) {
                        context.save();
                        context.setStrokeStyle('#3b82f6');
                        context.setFillStyle('#3b82f6');
                        hairpin.draw();
                        context.restore();
                    } else {
                        hairpin.draw();
                    }
                    
                    // Hitbox logic needs to know staff y offset
                    // Simplified: just use note Y
                    this._addModifierHitBox(canvas, yPos + (hpStaff==='bass'?bassY:trebleY), firstNote, lastNote, hp.start, 'hairpin', hp.end, hpStaff);
                }
            });
        }
    }

    renderEmptyState(scoreData) {
        const width = 300;
        const height = 160;
        const canvas = document.createElement('canvas');
        canvas.id = 'empty-score-chunk';
        this.container.appendChild(canvas);

        const vf = new Factory({
            renderer: { elementId: canvas.id, width, height, backend: Renderer.Backends.CANVAS }
        });
        const stave = vf.Stave({ x: 0, y: 40, width });
        stave.addClef(scoreData.clef)
             .addTimeSignature(scoreData.timeSignature)
             .addKeySignature(scoreData.keySignature || 'C');
        stave.draw();
    }

    getNotePosition(index, staff = null) {
        // Find position based on active staff if provided, otherwise find first match
        let pos;
        if (staff) {
            pos = this.notePositions.find(n => n.index === index && n.staff === staff);
        }
        if (!pos) {
            pos = this.notePositions.find(n => n.index === index);
        }

        if (pos) {
            const canvasRect = pos.canvas.offsetLeft;
            const canvasTop = pos.canvas.offsetTop;
            return {
                x: canvasRect + pos.x,
                y: canvasTop + (pos.staff === 'bass' ? 160 : 40), // Refine Y offset
                systemTop: canvasTop + pos.systemY // Absolute top of the system
            };
        }
        return null;
    }

    getNoteIndexAt(x, y, targetCanvas) {
        for (const pos of this.notePositions) {
            if (pos.canvas === targetCanvas && pos.bbox) {
                const hitX = pos.bbox.x - 5;
                const hitY = pos.bbox.y - 10;
                const hitW = pos.bbox.w + 10;
                const hitH = pos.bbox.h + 20;
                
                if (x >= hitX && x <= hitX + hitW && y >= hitY && y <= hitY + hitH) {
                    // Return staff and voice info too
                    return { index: pos.index, staff: pos.staff, voiceId: pos.voiceId ?? null };
                }
            }
        }
        return -1;
    }

    _addModifierHitBox(canvas, systemY, note1, note2, index, type, indexEnd = null, staff = 'treble') {
        const x1 = note1.getAbsoluteX();
        const x2 = note2.getAbsoluteX();
        
        // Ensure correct order
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const width = right - left;

        // Shrink hit area horizontally to avoid overlapping note heads
        // Notes are prioritized in hit testing, so we want the space *between* notes for slurs
        const margin = type === 'hairpin' ? 0 : 15;
        const x = left + margin;
        const w = Math.max(20, width - (margin * 2)); // Ensure at least 20px width

        // Get dynamic Y based on note position to handle Clef changes and pitch variance
        const bbox1 = note1.getBoundingBox();
        const bbox2 = note2.getBoundingBox();
        const y1 = bbox1.getY();
        const y2 = bbox2.getY();
        
        // Use the higher note (smaller Y) as base
        let y = Math.min(y1, y2);
        let h = 40; 
        
        // Adjust hit areas
        if (type === 'slur') {
            // Slurs arc above or below, expand hit area vertically
            y -= 40; 
            h = 120;
        } else if (type === 'hairpin') {
            y += 60; // Below stave
            h = 40;
        } else {
            // Ties are usually tighter between noteheads
            y -= 20;
            h = 80;
        }

        this.modifierPositions.push({
            type: type,
            index: index,
            endIndex: indexEnd || index,
            staff: staff,
            canvas: canvas,
            bbox: {
                x: x,
                y: y,
                w: w,
                h: h
            }
        });
    }

    getInteractionAt(x, y, targetCanvas) {
        const hit = this.getNoteIndexAt(x, y, targetCanvas);
        if (hit !== -1) return { type: 'note', index: hit.index, staff: hit.staff, voiceId: hit.voiceId };

        // Check Clefs
        if (this.clefPositions) {
            for (const cp of this.clefPositions) {
                if (cp.canvas === targetCanvas) {
                     if (x >= cp.x && x <= cp.x + cp.w && y >= cp.y - 10 && y <= cp.y + cp.h) {
                         return { type: 'clef', staff: cp.staff };
                     }
                }
            }
        }

        for (const mod of this.modifierPositions) {
            if (mod.canvas === targetCanvas) {
                // Relaxed hit test
                const bx = mod.bbox.x;
                const by = mod.bbox.y;
                const bw = mod.bbox.w;
                const bh = mod.bbox.h;
                
                // Allow some slop
                if (x >= bx && x <= bx + bw && y >= by - 20 && y <= by + bh + 20) {
                    if (mod.type === 'hairpin') {
                        return { type: 'hairpin', start: mod.index, end: mod.endIndex, staff: mod.staff };
                    }
                    return { type: mod.type, index: mod.index, staff: mod.staff };
                }
            }
        }
        return null;
    }
}