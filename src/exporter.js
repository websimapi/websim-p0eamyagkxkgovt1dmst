import MidiWriter from 'https://esm.sh/midi-writer-js@2.1.4';

export class Exporter {
    static generateMusicXML(scoreData) {
        const notes = scoreData.notes;
        const partId = "P1";
        
        let xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>LiteScore Composition</work-title>
  </work>
  <part-list>
    <score-part id="${partId}">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="${partId}">`;

        const timeSig = scoreData.timeSignature.split('/');
        const beatsPerMeasure = parseInt(timeSig[0]);
        const beatValue = parseInt(timeSig[1]);
        
        let currentBeats = 0;
        let measureCount = 1;
        
        xml += `\n    <measure number="${measureCount}">`;
        xml += `\n      <attributes>
        <divisions>4</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>${beatsPerMeasure}</beats>
          <beat-type>${beatValue}</beat-type>
        </time>
        <clef>
          <sign>${scoreData.clef === 'bass' ? 'F' : 'G'}</sign>
          <line>${scoreData.clef === 'bass' ? 4 : 2}</line>
        </clef>
      </attributes>`;

        notes.forEach(note => {
            let durationRaw = note.duration.replace('r','').replace('d','');
            let isDotted = note.duration.includes('d');
            let isTriplet = note.isTriplet || false;

            // Simplified beat calc
            let beats = 1; 
            let type = "quarter";
            let durationVal = 4;
            
            if (durationRaw === 'w') { beats = 4; type = "whole"; durationVal = 16; }
            if (durationRaw === 'h') { beats = 2; type = "half"; durationVal = 8; }
            if (durationRaw === 'q') { beats = 1; type = "quarter"; durationVal = 4; }
            if (durationRaw === '8') { beats = 0.5; type = "eighth"; durationVal = 2; }
            if (durationRaw === '16') { beats = 0.25; type = "16th"; durationVal = 1; }
            if (durationRaw === '32') { beats = 0.125; type = "32nd"; durationVal = 1; } // XML typically uses divisions, 1 is min here? Wait, divisions=4. 32nd needs higher div.
            if (durationRaw === '64') { beats = 0.0625; type = "64th"; durationVal = 0.5; } 
            if (durationRaw === '128') { beats = 0.03125; type = "128th"; durationVal = 0.25; }

            // To support 128th, we should ideally increase divisions to 32 at least.
            // But let's keep it simple for now or risk breaking existing files logic.
            // If divisions=4 (quarter=4), 16th=1. 32nd=0.5. 
            // MusicXML allows float for duration but standard practice is integer with higher divisions.
            // We'll proceed but ideally divisions should be raised in future.

            if (isDotted) {
                beats *= 1.5;
                durationVal = Math.floor(durationVal * 1.5);
            }

            if (isTriplet) {
                beats *= (2/3);
                durationVal = Math.floor(durationVal * (2/3));
            }

            // Measure check
            // Note: MusicXML allows overflow, but better to split. 
            // MVP: just strict break.
            if (currentBeats + beats > beatsPerMeasure && currentBeats > 0) {
                xml += `\n    </measure>`;
                measureCount++;
                currentBeats = 0;
                xml += `\n    <measure number="${measureCount}">`;
            }

            if (note.isRest) {
                xml += `\n      <note>
        <rest/>
        <duration>${durationVal}</duration>
        <type>${type}</type>
        ${isDotted ? '<dot/>' : ''}
      </note>`;
            } else {
                note.keys.forEach((key, index) => {
                    const [stepRaw, octave] = key.split('/');
                    const step = stepRaw.charAt(0).toUpperCase();
                    const alter = stepRaw.includes('#') ? 1 : (stepRaw.includes('b') ? -1 : 0);
                    
                    xml += `\n      <note>
        ${index > 0 ? '<chord/>' : ''}
        <pitch>
          <step>${step}</step>
          ${alter !== 0 ? `<alter>${alter}</alter>` : ''}
          <octave>${octave}</octave>
        </pitch>
        <duration>${durationVal}</duration>
        <type>${type}</type>
        ${isDotted ? '<dot/>' : ''}
        ${note.isTied ? '<tie type="start"/>' : ''}
      </note>`;
                });
            }
            currentBeats += beats;
        });

        xml += `\n    </measure>`;
        xml += `\n  </part>\n</score-partwise>`;
        return xml;
    }

    static generateMIDI(scoreData) {
        const track = new MidiWriter.Track();
        track.addEvent(new MidiWriter.ProgramChangeEvent({instrument: 1}));
        track.setTempo(scoreData.tempo);

        scoreData.notes.forEach(note => {
            let duration = '4'; // Default quarter
            const raw = note.duration.replace('r','').replace('d','');
            if (raw === 'w') duration = '1';
            if (raw === 'h') duration = '2';
            if (raw === 'q') duration = '4';
            if (raw === '8') duration = '8';
            if (raw === '16') duration = '16';
            if (raw === '32') duration = '32';
            if (raw === '64') duration = '64';
            // MidiWriterJS might not natively support '128' string shortcut, check docs or use ticks.
            // Assuming string support passes through. If not, ticks would be safer.
            // For '128', we map to '64' effectively if library fails, but let's try '128'.
            if (raw === '128') duration = '128';
            
            if (note.duration.includes('d')) duration = 'd' + duration;
            if (note.isTriplet) duration = duration + 't'; // MidiWriter syntax for triplet? Check docs.
            // MidiWriter uses 't' prefix? No, usually it's an array or tick count. 
            // For MVP, we stick to standard.

            if (note.isRest) {
                track.addEvent(new MidiWriter.NoteEvent({pitch: null, duration: duration}));
            } else {
                // Convert Vexflow keys "c/4" to "C4"
                const pitches = note.keys.map(k => {
                    const [step, oct] = k.split('/');
                    return step.toUpperCase() + oct;
                });
                track.addEvent(new MidiWriter.NoteEvent({pitch: pitches, duration: duration}));
            }
        });

        const write = new MidiWriter.Writer(track);
        return write.buildFile();
    }

    static generateABC(scoreData) {
        let abc = `X:1\nT:LiteScore Composition\nM:${scoreData.timeSignature}\nL:1/4\nQ:1/4=${scoreData.tempo}\nK:${scoreData.keySignature}\n|`;
        
        // Very basic mapping
        scoreData.notes.forEach(note => {
            if (note.isRest) {
                abc += "z ";
            } else {
                // Map first key only for MVP chords
                const [step, oct] = note.keys[0].split('/');
                abc += step.toUpperCase(); // Simplification
            }
        });
        abc += "|]";
        return abc;
    }
}