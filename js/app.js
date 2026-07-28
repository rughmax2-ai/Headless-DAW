(() => {
  "use strict";

  // ─── Constants ───────────────────────────────────────────────────────────────

  const KEY_TO_OFFSET = {
    a:0, w:1, s:2, e:3, d:4, f:5, t:6,
    g:7, y:8, h:9, u:10, j:11, k:12, o:13, l:14,
  };
  const WHITE_OFFSETS = [0,2,4,5,7,9,11,12,14];
  const BLACK_OFFSETS = [1,3,null,6,8,10,null,13];

  // Chords in key of C
  const CHORDS = [
    { roman:"I",     name:"Cmaj",  notes:[60,64,67]    },
    { roman:"ii",    name:"Dmin",  notes:[62,65,69]    },
    { roman:"iii",   name:"Emin",  notes:[64,67,71]    },
    { roman:"IV",    name:"Fmaj",  notes:[65,69,72]    },
    { roman:"V",     name:"Gmaj",  notes:[67,71,74]    },
    { roman:"vi",    name:"Amin",  notes:[69,72,76]    },
    { roman:"vii°",  name:"Bdim",  notes:[71,74,77]    },
    { roman:"Imaj7", name:"Cmaj7", notes:[60,64,67,71] },
  ];

  // Lead ribbon: C major pentatonic over 3 octaves
  const RIBBON_NOTES = [
    36,38,40,43,45,
    48,50,52,55,57,
    60,62,64,67,69,
    72,74,76,79,81,
  ];
  const NOTE_NAMES = ["C","","D","","E","F","","G","","A","","B"];

  function midiToName(midi) {
    const oct  = Math.floor(midi / 12) - 1;
    const name = NOTE_NAMES[midi % 12];
    return name ? `${name}${oct}` : "";
  }

  // Drum definitions
  const DRUMS = [
    { id:"kick",    label:"KICK",    emoji:"🥁" },
    { id:"snare",   label:"SNARE",   emoji:"🎯" },
    { id:"hihat",   label:"HI-HAT", emoji:"〰️"  },
    { id:"openhat", label:"OPEN HT",emoji:"🔔"  },
    { id:"clap",    label:"CLAP",    emoji:"👏"  },
    { id:"tom",     label:"TOM",     emoji:"🟣"  },
  ];

  // ─── DOM refs ─────────────────────────────────────────────────────────────────

  const $  = id => document.getElementById(id);
  const els = {
    waveform:  $("waveform"),
    attack:    $("attack"),
    decay:     $("decay"),
    sustain:   $("sustain"),
    release:   $("release"),
    cutoff:    $("cutoff"),
    resonance: $("resonance"),
    volume:    $("volume"),
    octUp:     $("oct-up"),
    octDn:     $("oct-dn"),
    octVal:    $("oct-val"),
    keyboard:  $("keyboard"),
    recordBtn: $("record-btn"),
    recStatus: $("record-status"),
    recordings:$("recordings"),
    audWarn:   $("audio-warning"),
    bpm:       $("bpm"),
    bpmVal:    $("bpm-val"),
    btnPlay:   $("btn-play"),
    btnRec:    $("btn-rec"),
    btnClr:    $("btn-clr"),
    beatRow:   $("beat-row"),
    chordGrid: $("chord-grid"),
    ribbon:    $("ribbon"),
    ribbonGlow:$("ribbon-glow"),
    leadNote:  $("lead-note"),
    drumGrid:  $("drum-grid"),
    viz:       $("viz"),
  };

  // ─── Value displays ───────────────────────────────────────────────────────────

  function bindVal(id, fmt) {
    const inp = els[id] || document.getElementById(id);
    const out = document.querySelector(`.cv[data-for="${id}"]`);
    if (!inp || !out) return;
    const upd = () => (out.textContent = fmt(parseFloat(inp.value)));
    inp.addEventListener("input", upd);
    upd();
  }
  bindVal("attack",    v => `${v.toFixed(3)}s`);
  bindVal("decay",     v => `${v.toFixed(3)}s`);
  bindVal("sustain",   v => v.toFixed(2));
  bindVal("release",   v => `${v.toFixed(3)}s`);
  bindVal("cutoff",    v => `${Math.round(v)}Hz`);
  bindVal("resonance", v => v.toFixed(1));
  bindVal("volume",    v => `${Math.round(v * 100)}%`);

  // ─── SynthEngine ─────────────────────────────────────────────────────────────

  class SynthEngine {
    constructor() {
      this.ctx        = null;
      this.masterGain = null;
      this.analyser   = null;
      this.recordDest = null;
      this.voices     = new Map();
      this.octave     = 4;
    }

    ensureContext() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume();
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = parseFloat(els.volume.value);

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;

      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      if (this.ctx.createMediaStreamDestination) {
        this.recordDest = this.ctx.createMediaStreamDestination();
        this.masterGain.connect(this.recordDest);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    }

    setVolume(v) {
      if (this.masterGain)
        this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    }

    noteOn(note) {
      this.ensureContext();
      if (this.voices.has(note)) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const freq = 440 * Math.pow(2, (note - 69) / 12);

      const osc   = ctx.createOscillator();
      osc.type    = els.waveform.value;
      osc.frequency.value = freq;

      const filter = ctx.createBiquadFilter();
      filter.type  = "lowpass";
      filter.frequency.value = parseFloat(els.cutoff.value);
      filter.Q.value         = parseFloat(els.resonance.value);

      const vGain = ctx.createGain();
      vGain.gain.value = 0;

      osc.connect(filter);
      filter.connect(vGain);
      vGain.connect(this.masterGain);

      const atk  = parseFloat(els.attack.value);
      const dec  = parseFloat(els.decay.value);
      const sus  = parseFloat(els.sustain.value);
      const peak = 0.28;

      vGain.gain.cancelScheduledValues(now);
      vGain.gain.setValueAtTime(0, now);
      vGain.gain.linearRampToValueAtTime(peak, now + atk);
      vGain.gain.linearRampToValueAtTime(peak * sus, now + atk + dec);

      osc.start(now);
      this.voices.set(note, { osc, vGain, filter });
    }

    noteOff(note) {
      const voice = this.voices.get(note);
      if (!voice) return;
      this.voices.delete(note);
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const rel = parseFloat(els.release.value);
      const cur = voice.vGain.gain.value;

      voice.vGain.gain.cancelScheduledValues(now);
      voice.vGain.gain.setValueAtTime(cur, now);
      voice.vGain.gain.linearRampToValueAtTime(0, now + rel);

      voice.osc.stop(now + rel + 0.02);
      voice.osc.addEventListener("ended", () => {
        voice.osc.disconnect();
        voice.vGain.disconnect();
        voice.filter.disconnect();
      });
    }

    // Schedule a note to play at a future audioCtx time (for loop playback)
    scheduleNote(note, startTime, duration, waveOverride) {
      if (!this.ctx) return;
      const ctx  = this.ctx;
      const freq = 440 * Math.pow(2, (note - 69) / 12);
      const atk  = parseFloat(els.attack.value);
      const dec  = parseFloat(els.decay.value);
      const sus  = parseFloat(els.sustain.value);
      const rel  = parseFloat(els.release.value);
      const peak = 0.28;
      const dur  = Math.max(duration, atk + dec + 0.01);

      const osc   = ctx.createOscillator();
      osc.type    = waveOverride || els.waveform.value;
      osc.frequency.value = freq;

      const flt = ctx.createBiquadFilter();
      flt.type  = "lowpass";
      flt.frequency.value = parseFloat(els.cutoff.value);
      flt.Q.value         = parseFloat(els.resonance.value);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(peak, startTime + atk);
      g.gain.linearRampToValueAtTime(peak * sus, startTime + atk + dec);
      g.gain.setValueAtTime(peak * sus, startTime + dur);
      g.gain.linearRampToValueAtTime(0, startTime + dur + rel);

      osc.connect(flt);
      flt.connect(g);
      g.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + dur + rel + 0.05);
      osc.addEventListener("ended", () => {
        osc.disconnect(); g.disconnect(); flt.disconnect();
      });
    }

    updateFilter() {
      if (!this.ctx) return;
      const cutoff    = parseFloat(els.cutoff.value);
      const resonance = parseFloat(els.resonance.value);
      const now = this.ctx.currentTime;
      for (const { filter } of this.voices.values()) {
        filter.frequency.setTargetAtTime(cutoff, now, 0.01);
        filter.Q.setTargetAtTime(resonance, now, 0.01);
      }
    }
  }

  const synth = new SynthEngine();
  els.volume.addEventListener("input", () => synth.setVolume(parseFloat(els.volume.value)));
  els.cutoff.addEventListener("input",    () => synth.updateFilter());
  els.resonance.addEventListener("input", () => synth.updateFilter());

  // ─── Drum synthesis ───────────────────────────────────────────────────────────

  function makeBurst(ctx, duration) {
    const len = Math.ceil(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function playDrum(type, time) {
    synth.ensureContext();
    const ctx  = synth.ctx;
    const dest = synth.masterGain;

    if (type === "kick") {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(160, time);
      osc.frequency.exponentialRampToValueAtTime(0.001, time + 0.45);
      gain.gain.setValueAtTime(1.2, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
      osc.connect(gain); gain.connect(dest);
      osc.start(time); osc.stop(time + 0.46);
      osc.addEventListener("ended", () => { osc.disconnect(); gain.disconnect(); });

    } else if (type === "snare") {
      // noise burst
      const noise = ctx.createBufferSource();
      noise.buffer = makeBurst(ctx, 0.25);
      const nhpf = ctx.createBiquadFilter();
      nhpf.type = "highpass"; nhpf.frequency.value = 1200;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.9, time);
      ng.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      noise.connect(nhpf); nhpf.connect(ng); ng.connect(dest);
      noise.start(time); noise.stop(time + 0.25);
      noise.addEventListener("ended", () => { noise.disconnect(); nhpf.disconnect(); ng.disconnect(); });
      // tone component
      const osc  = ctx.createOscillator();
      const og   = ctx.createGain();
      osc.type = "triangle"; osc.frequency.value = 200;
      og.gain.setValueAtTime(0.55, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
      osc.connect(og); og.connect(dest);
      osc.start(time); osc.stop(time + 0.1);
      osc.addEventListener("ended", () => { osc.disconnect(); og.disconnect(); });

    } else if (type === "hihat") {
      const noise = ctx.createBufferSource();
      noise.buffer = makeBurst(ctx, 0.06);
      const bpf   = ctx.createBiquadFilter();
      bpf.type = "bandpass"; bpf.frequency.value = 10000; bpf.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      noise.connect(bpf); bpf.connect(g); g.connect(dest);
      noise.start(time); noise.stop(time + 0.07);
      noise.addEventListener("ended", () => { noise.disconnect(); bpf.disconnect(); g.disconnect(); });

    } else if (type === "openhat") {
      const noise = ctx.createBufferSource();
      noise.buffer = makeBurst(ctx, 0.35);
      const bpf   = ctx.createBiquadFilter();
      bpf.type = "bandpass"; bpf.frequency.value = 9000; bpf.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.32);
      noise.connect(bpf); bpf.connect(g); g.connect(dest);
      noise.start(time); noise.stop(time + 0.36);
      noise.addEventListener("ended", () => { noise.disconnect(); bpf.disconnect(); g.disconnect(); });

    } else if (type === "clap") {
      [0, 0.012, 0.022, 0.032].forEach(off => {
        const noise = ctx.createBufferSource();
        noise.buffer = makeBurst(ctx, 0.08);
        const bpf = ctx.createBiquadFilter();
        bpf.type = "bandpass"; bpf.frequency.value = 1800; bpf.Q.value = 0.7;
        const g = ctx.createGain();
        const t = time + off;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.7, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        noise.connect(bpf); bpf.connect(g); g.connect(dest);
        noise.start(t); noise.stop(t + 0.1);
        noise.addEventListener("ended", () => { noise.disconnect(); bpf.disconnect(); g.disconnect(); });
      });

    } else if (type === "tom") {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(180, time);
      osc.frequency.exponentialRampToValueAtTime(60, time + 0.25);
      gain.gain.setValueAtTime(0.9, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
      osc.connect(gain); gain.connect(dest);
      osc.start(time); osc.stop(time + 0.36);
      osc.addEventListener("ended", () => { osc.disconnect(); gain.disconnect(); });
    }
  }

  // ─── Loop Engine ─────────────────────────────────────────────────────────────

  class LoopEngine {
    constructor() {
      this.bpm         = 120;
      this.numBars     = 4;
      this.beatsPerBar = 4;
      this.isPlaying   = false;
      this.isRecording = false;
      this.events      = [];      // { time: seconds_from_loop_start, play(scheduledCtxTime) }
      this._origin     = null;    // ctx.currentTime when loop was started
      this._nextStart  = null;    // ctx.currentTime of next loop iteration start
      this._timer      = null;
    }

    get loopDuration() { return (60 / this.bpm) * this.beatsPerBar * this.numBars; }
    get beatDuration()  { return 60 / this.bpm; }
    get totalBeats()    { return this.beatsPerBar * this.numBars; }

    // Current position within loop (seconds, 0..loopDuration)
    get position() {
      if (!this.isPlaying || !synth.ctx) return 0;
      return (synth.ctx.currentTime - this._origin) % this.loopDuration;
    }

    // Current beat index (0..15)
    get beatIndex() {
      return Math.floor(this.position / this.beatDuration) % this.totalBeats;
    }

    start() {
      if (this.isPlaying) return;
      synth.ensureContext();
      this.isPlaying = true;
      this._origin    = synth.ctx.currentTime;
      this._nextStart = this._origin;
      this._schedule();
    }

    stop() {
      this.isPlaying   = false;
      this.isRecording = false;
      clearTimeout(this._timer);
      this._timer = null;
    }

    startRecording() {
      if (!this.isPlaying) this.start();
      this.isRecording = true;
    }

    stopRecording() {
      this.isRecording = false;
    }

    clearLoop() {
      this.events = [];
    }

    // Add a recorded event at the current loop position
    record(playFn) {
      if (!this.isRecording || !this.isPlaying || !synth.ctx) return;
      this.recordAt(this.position, playFn);
    }

    // Add a recorded event at an explicit loop position (seconds from loop start)
    recordAt(timeInLoop, playFn) {
      if (!this.isRecording || !this.isPlaying) return;
      const t = Math.min(Math.max(timeInLoop, 0), this.loopDuration - 0.01);
      this.events.push({ time: t, play: playFn });
    }

    _schedule() {
      if (!this.isPlaying || !synth.ctx) {
        this._timer = setTimeout(() => this._schedule(), 25);
        return;
      }
      const now      = synth.ctx.currentTime;
      const lookAhead = 0.15;

      while (this._nextStart < now + lookAhead) {
        const loopStart = this._nextStart;
        // Only schedule events that haven't already started
        for (const ev of this.events) {
          const evTime = loopStart + ev.time;
          if (evTime >= now - 0.001) {
            ev.play(evTime);
          }
        }
        this._nextStart += this.loopDuration;
      }

      this._timer = setTimeout(() => this._schedule(), 25);
    }
  }

  const loop = new LoopEngine();

  // ─── Loop UI ──────────────────────────────────────────────────────────────────

  // Build beat grid (16 cells)
  const beatCells = [];
  for (let i = 0; i < 16; i++) {
    const cell = document.createElement("div");
    cell.className = "beat-cell" + (i % 4 === 0 ? " downbeat" : "");
    els.beatRow.appendChild(cell);
    beatCells.push(cell);
  }

  let lastBeat = -1;
  function animateBeat() {
    requestAnimationFrame(animateBeat);
    if (!loop.isPlaying) {
      if (lastBeat !== -1) {
        beatCells.forEach(c => c.classList.remove("lit"));
        lastBeat = -1;
      }
      return;
    }
    const beat = loop.beatIndex;
    if (beat !== lastBeat) {
      beatCells.forEach((c, i) => c.classList.toggle("lit", i === beat));
      lastBeat = beat;
    }
  }
  animateBeat();

  // BPM slider
  els.bpm.addEventListener("input", () => {
    els.bpmVal.textContent = els.bpm.value;
    // Changing BPM resets timing; stop/clear/restart if playing
    if (loop.isPlaying) {
      const wasRec = loop.isRecording;
      loop.stop();
      loop.clearLoop();
      loop.bpm = parseInt(els.bpm.value, 10);
      loop.start();
      if (wasRec) loop.startRecording();
    } else {
      loop.bpm = parseInt(els.bpm.value, 10);
    }
  });

  // Play button
  els.btnPlay.addEventListener("click", () => {
    if (loop.isPlaying) {
      loop.stop();
      els.btnPlay.classList.remove("active");
      els.btnPlay.innerHTML = "&#9654; PLAY";
      els.btnRec.classList.remove("active");
      els.btnRec.innerHTML = "&#9210; REC";
    } else {
      loop.start();
      els.btnPlay.classList.add("active");
      els.btnPlay.innerHTML = "&#9646;&#9646; STOP";
    }
  });

  // Rec button
  els.btnRec.addEventListener("click", () => {
    if (loop.isRecording) {
      loop.stopRecording();
      els.btnRec.classList.remove("active");
      els.btnRec.innerHTML = "&#9210; REC";
    } else {
      loop.startRecording();
      els.btnRec.classList.add("active");
      els.btnRec.innerHTML = "&#9210; REC&#8201;●";
      // also ensure play is active
      if (!els.btnPlay.classList.contains("active")) {
        els.btnPlay.classList.add("active");
        els.btnPlay.innerHTML = "&#9646;&#9646; STOP";
      }
    }
  });

  // Clear button
  els.btnClr.addEventListener("click", () => {
    loop.clearLoop();
    // brief flash
    els.btnClr.style.color = "var(--o)";
    setTimeout(() => (els.btnClr.style.color = ""), 300);
  });

  // ─── Chord Pads ───────────────────────────────────────────────────────────────

  CHORDS.forEach((chord, idx) => {
    const pad = document.createElement("div");
    pad.className = "chord-pad";
    pad.setAttribute("role", "button");
    pad.setAttribute("aria-label", chord.name);
    pad.setAttribute("tabindex", "0");
    pad.dataset.idx = idx;
    pad.innerHTML = `
      <div class="chord-roman">${chord.roman}</div>
      <div class="chord-name">${chord.name}</div>
      <div class="chord-notes-disp">${chord.notes.map(n => NOTE_NAMES[n % 12] || "").filter(Boolean).join(" ")}</div>
    `;

    let pressTime    = null;
    let pressLoopPos = null;

    function chordOn() {
      synth.ensureContext();
      pressTime    = synth.ctx.currentTime;
      pressLoopPos = loop.isPlaying ? loop.position : null;
      pad.classList.add("active");
      chord.notes.forEach(n => synth.noteOn(n));
    }

    function chordOff() {
      pad.classList.remove("active");
      const now = synth.ctx ? synth.ctx.currentTime : null;
      const dur = (pressTime !== null && now !== null)
        ? Math.max(now - pressTime, 0.05)
        : 0.5;
      const startPos = pressLoopPos !== null ? pressLoopPos : 0;
      const capDur   = Math.min(dur, loop.loopDuration - startPos);
      const notes    = [...chord.notes];
      chord.notes.forEach(n => synth.noteOff(n));
      pressTime    = null;
      pressLoopPos = null;

      // Record at the time the chord was pressed, not released
      loop.recordAt(startPos, t => notes.forEach(n => synth.scheduleNote(n, t, capDur)));
    }

    pad.addEventListener("pointerdown",  e => { e.preventDefault(); chordOn(); });
    pad.addEventListener("pointerup",    ()  => chordOff());
    pad.addEventListener("pointerleave", ()  => { if (pad.classList.contains("active")) chordOff(); });
    pad.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !pad.classList.contains("active")) chordOn(); });
    pad.addEventListener("keyup",   e => { if (e.key === " " || e.key === "Enter") chordOff(); });

    els.chordGrid.appendChild(pad);
  });

  // ─── Lead Ribbon ─────────────────────────────────────────────────────────────

  // Build note labels on ribbon
  RIBBON_NOTES.forEach((note) => {
    const lbl  = document.createElement("div");
    lbl.className = "ribbon-lbl";
    const name = NOTE_NAMES[note % 12];
    lbl.textContent = name || "";
    document.getElementById("ribbon-labels").appendChild(lbl);
  });

  let ribbonActive  = false;
  let ribbonOsc     = null;
  let ribbonGain    = null;
  let ribbonStart   = null;   // ctx time
  let ribbonNote    = null;   // current MIDI note
  let ribbonNoteStart = null; // ctx time of current note segment start
  let ribbonSegStartInLoop = null; // loop position when segment started

  function ribbonNoteAtX(x) {
    const w   = els.ribbon.clientWidth;
    const idx = Math.min(Math.floor((x / w) * RIBBON_NOTES.length), RIBBON_NOTES.length - 1);
    return RIBBON_NOTES[Math.max(0, idx)];
  }

  function ribbonStartNote(note) {
    synth.ensureContext();
    const ctx = synth.ctx;
    const now = ctx.currentTime;

    ribbonNote      = note;
    ribbonNoteStart = now;
    ribbonSegStartInLoop = loop.isPlaying ? loop.position : null;

    if (ribbonOsc) { ribbonOsc.stop(); ribbonOsc = null; }
    if (ribbonGain) { ribbonGain.gain.setTargetAtTime(0, now, 0.01); }

    ribbonOsc  = ctx.createOscillator();
    ribbonOsc.type = "sawtooth";
    ribbonOsc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);

    ribbonGain = ctx.createGain();
    ribbonGain.gain.setValueAtTime(0, now);
    ribbonGain.gain.linearRampToValueAtTime(0.35, now + 0.04);

    ribbonOsc.connect(ribbonGain);
    ribbonGain.connect(synth.masterGain);
    ribbonOsc.start(now);

    const nameStr = midiToName(note) || "---";
    els.leadNote.textContent = nameStr;
  }

  function ribbonChangeNote(note) {
    if (note === ribbonNote || !ribbonOsc) return;

    // Record the completed segment using its start position in the loop
    const now = synth.ctx.currentTime;
    const dur = now - ribbonNoteStart;
    if (loop.isRecording && ribbonSegStartInLoop !== null && dur > 0.05) {
      const segStart = ribbonSegStartInLoop;
      const capNote  = ribbonNote;
      const capDur   = Math.min(dur, loop.loopDuration - segStart);
      loop.recordAt(segStart, t => synth.scheduleNote(capNote, t, capDur, "sawtooth"));
    }

    ribbonNote      = note;
    ribbonNoteStart = now;
    ribbonSegStartInLoop = loop.isPlaying ? loop.position : null;

    const freq = 440 * Math.pow(2, (note - 69) / 12);
    ribbonOsc.frequency.setTargetAtTime(freq, now, 0.015);
    els.leadNote.textContent = midiToName(note) || "---";
  }

  function ribbonStop() {
    if (!ribbonActive) return;
    ribbonActive = false;
    els.ribbonGlow.style.display = "none";
    els.leadNote.textContent = "\u2014\u2014\u2014";

    const now = synth.ctx ? synth.ctx.currentTime : 0;
    const dur = now - ribbonNoteStart;

    // Record the final segment using its start position in the loop
    if (loop.isRecording && ribbonSegStartInLoop !== null && dur > 0.05) {
      const segStart = ribbonSegStartInLoop;
      const capNote  = ribbonNote;
      const capDur   = Math.min(dur, loop.loopDuration - segStart);
      loop.recordAt(segStart, t => synth.scheduleNote(capNote, t, capDur, "sawtooth"));
    }

    if (ribbonGain) {
      ribbonGain.gain.setTargetAtTime(0, now, 0.06);
      if (ribbonOsc) {
        ribbonOsc.stop(now + 0.4);
        ribbonOsc.addEventListener("ended", () => {
          if (ribbonOsc) { ribbonOsc.disconnect(); ribbonOsc = null; }
          if (ribbonGain) { ribbonGain.disconnect(); ribbonGain = null; }
        });
      }
    }
    ribbonNote      = null;
    ribbonNoteStart = null;
    ribbonSegStartInLoop = null;
  }

  els.ribbon.addEventListener("pointerdown", e => {
    e.preventDefault();
    ribbonActive = true;
    ribbonStart  = Date.now();
    const rect   = els.ribbon.getBoundingClientRect();
    const x      = e.clientX - rect.left;
    const pct    = (x / rect.width) * 100;

    els.ribbonGlow.style.display = "block";
    els.ribbonGlow.style.left    = `${pct}%`;

    ribbonStartNote(ribbonNoteAtX(x));
  });

  els.ribbon.addEventListener("pointermove", e => {
    if (!ribbonActive) return;
    const rect = els.ribbon.getBoundingClientRect();
    const x    = e.clientX - rect.left;
    const pct  = Math.max(0, Math.min(100, (x / rect.width) * 100));
    els.ribbonGlow.style.left = `${pct}%`;
    ribbonChangeNote(ribbonNoteAtX(x));
  });

  els.ribbon.addEventListener("pointerup",    () => ribbonStop());
  els.ribbon.addEventListener("pointerleave", () => { if (ribbonActive) ribbonStop(); });

  // ─── Drum Pads ────────────────────────────────────────────────────────────────

  DRUMS.forEach(({ id, label, emoji }) => {
    const pad = document.createElement("button");
    pad.type = "button";
    pad.className = "drum-pad";
    pad.dataset.drum = id;
    pad.innerHTML = `<span class="drum-emoji">${emoji}</span><span>${label}</span>`;

    function hit() {
      synth.ensureContext();
      const now = synth.ctx.currentTime;
      playDrum(id, now);
      pad.classList.add("active");
      setTimeout(() => pad.classList.remove("active"), 120);
      const drumId = id;
      loop.record(t => playDrum(drumId, t));
    }

    pad.addEventListener("pointerdown", e => { e.preventDefault(); hit(); });
    pad.addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") hit(); });

    els.drumGrid.appendChild(pad);
  });

  // ─── Octave control ───────────────────────────────────────────────────────────

  function setOctave(delta) {
    synth.octave = Math.min(7, Math.max(1, synth.octave + delta));
    els.octVal.textContent = synth.octave;
  }
  els.octUp.addEventListener("click", () => setOctave(1));
  els.octDn.addEventListener("click", () => setOctave(-1));

  function noteForOffset(off) { return (synth.octave + 1) * 12 + off; }

  // ─── Visual keyboard ──────────────────────────────────────────────────────────

  const keyEls = new Map();

  function buildKeyboard() {
    els.keyboard.innerHTML = "";
    WHITE_OFFSETS.forEach(off => {
      const key = document.createElement("div");
      key.className = "key white";
      key.dataset.offset = off;
      els.keyboard.appendChild(key);
      keyEls.set(off, key);
    });
    const ww = 100 / WHITE_OFFSETS.length;
    let wi = 0;
    BLACK_OFFSETS.forEach(off => {
      if (off === null) { wi++; return; }
      const key = document.createElement("div");
      key.className = "key black";
      key.dataset.offset = off;
      key.style.left = `${ww * (wi + 1) - 2.75}%`;
      els.keyboard.appendChild(key);
      keyEls.set(off, key);
      wi++;
    });
  }
  buildKeyboard();

  function pressOffset(off) {
    synth.noteOn(noteForOffset(off));
    keyEls.get(off)?.classList.add("active");
  }
  function releaseOffset(off) {
    synth.noteOff(noteForOffset(off));
    keyEls.get(off)?.classList.remove("active");
  }

  let ptrDown = false;
  let activePtrOff = null;

  function offFromEvent(e) {
    const t = e.target.closest(".key");
    return t ? parseInt(t.dataset.offset, 10) : null;
  }

  els.keyboard.addEventListener("pointerdown", e => {
    const off = offFromEvent(e);
    if (off === null) return;
    ptrDown = true; activePtrOff = off;
    pressOffset(off);
  });
  els.keyboard.addEventListener("pointerover", e => {
    if (!ptrDown) return;
    const off = offFromEvent(e);
    if (off === null || off === activePtrOff) return;
    if (activePtrOff !== null) releaseOffset(activePtrOff);
    activePtrOff = off;
    pressOffset(off);
  });
  document.addEventListener("pointerup", () => {
    if (activePtrOff !== null) releaseOffset(activePtrOff);
    ptrDown = false; activePtrOff = null;
  });
  els.keyboard.addEventListener("pointerleave", e => {
    if (ptrDown && e.target === els.keyboard && activePtrOff !== null) {
      releaseOffset(activePtrOff);
      activePtrOff = null;
    }
  });
  els.keyboard.addEventListener("contextmenu", e => e.preventDefault());

  // ─── Computer keyboard ────────────────────────────────────────────────────────

  const heldKeys = new Set();
  window.addEventListener("keydown", e => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "z") return setOctave(-1);
    if (k === "x") return setOctave(1);
    if (!(k in KEY_TO_OFFSET) || heldKeys.has(k)) return;
    heldKeys.add(k);
    pressOffset(KEY_TO_OFFSET[k]);
  });
  window.addEventListener("keyup", e => {
    const k = e.key.toLowerCase();
    if (!heldKeys.has(k)) return;
    heldKeys.delete(k);
    releaseOffset(KEY_TO_OFFSET[k]);
  });

  // ─── Audio Recorder ───────────────────────────────────────────────────────────

  const Rec = { recorder:null, chunks:[], startedAt:0, timerId:null };

  function pickMime() {
    const candidates = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"];
    return candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
  }
  function extFor(mime) {
    if (mime.includes("webm")) return "webm";
    if (mime.includes("ogg"))  return "ogg";
    if (mime.includes("mp4"))  return "m4a";
    return "dat";
  }
  function fmtMs(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  }

  function startRec() {
    synth.ensureContext();
    if (!synth.recordDest) { els.audWarn.hidden = false; return; }
    const mime = pickMime();
    if (!window.MediaRecorder || !mime) { els.audWarn.hidden = false; return; }
    Rec.chunks = [];
    const mr = new MediaRecorder(synth.recordDest.stream, { mimeType: mime });
    mr.addEventListener("dataavailable", e => { if (e.data?.size > 0) Rec.chunks.push(e.data); });
    mr.addEventListener("stop", () => addRec(new Blob(Rec.chunks, { type: mime }), mime));
    mr.start(250);
    Rec.recorder  = mr;
    Rec.startedAt = Date.now();
    els.recordBtn.classList.add("recording");
    els.recordBtn.lastChild.textContent = " STOP";
    Rec.timerId = setInterval(() => {
      els.recStatus.textContent = `● ${fmtMs(Date.now() - Rec.startedAt)}`;
    }, 200);
  }

  function stopRec() {
    if (!Rec.recorder || Rec.recorder.state === "inactive") return;
    Rec.recorder.stop();
    clearInterval(Rec.timerId);
    els.recordBtn.classList.remove("recording");
    els.recordBtn.lastChild.textContent = " REC";
    els.recStatus.textContent = "READY";
  }

  els.recordBtn.addEventListener("click", () => {
    (Rec.recorder && Rec.recorder.state === "recording") ? stopRec() : startRec();
  });

  function addRec(blob, mime) {
    const url  = URL.createObjectURL(blob);
    const ext  = extFor(mime);
    const ts   = new Date();
    const name = `synth-x-${ts.toISOString().replace(/[:.]/g, "-")}.${ext}`;

    const li   = document.createElement("li");
    const span = document.createElement("span");
    span.className   = "rec-name";
    span.textContent = ts.toLocaleTimeString();

    const audio    = document.createElement("audio");
    audio.controls = true;
    audio.src      = url;

    const dl   = document.createElement("a");
    dl.href    = url; dl.download = name; dl.textContent = "DL";

    const del  = document.createElement("button");
    del.type = "button"; del.className = "del"; del.textContent = "DEL";
    del.addEventListener("click", () => { URL.revokeObjectURL(url); li.remove(); });

    li.append(span, audio, dl, del);
    els.recordings.prepend(li);
  }

  if (!window.MediaRecorder) els.audWarn.hidden = false;

  // ─── Canvas visualizer ────────────────────────────────────────────────────────

  (function setupViz() {
    const canvas = els.viz;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");

    function resize() {
      canvas.width  = canvas.clientWidth  || 400;
      canvas.height = canvas.clientHeight || 80;
    }
    resize();
    window.addEventListener("resize", resize);

    const buf = new Uint8Array(1024);

    function draw() {
      requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      ctx2d.clearRect(0, 0, w, h);

      if (!synth.analyser) {
        // idle — draw a dim flat line with scanline shimmer
        ctx2d.strokeStyle = "rgba(0,229,255,0.12)";
        ctx2d.lineWidth   = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(0, h / 2);
        ctx2d.lineTo(w, h / 2);
        ctx2d.stroke();
        return;
      }

      synth.analyser.getByteTimeDomainData(buf);

      ctx2d.strokeStyle = "#00e5ff";
      ctx2d.lineWidth   = 1.5;
      ctx2d.shadowBlur  = 10;
      ctx2d.shadowColor = "#00e5ff";

      ctx2d.beginPath();
      const step = w / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const y = ((buf[i] / 128) - 1) * (h / 2) + h / 2;
        i === 0 ? ctx2d.moveTo(0, y) : ctx2d.lineTo(i * step, y);
      }
      ctx2d.stroke();
      ctx2d.shadowBlur = 0;
    }
    draw();
  })();

})();
