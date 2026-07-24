(() => {
  "use strict";

  // ---- Keyboard layout: computer keys mapped to semitone offsets from C ----
  const KEY_TO_OFFSET = {
    a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6,
    g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14,
  };
  const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12, 14];
  const BLACK_OFFSETS = [1, 3, null, 6, 8, 10, null, 13];

  const els = {
    waveform: document.getElementById("waveform"),
    attack: document.getElementById("attack"),
    decay: document.getElementById("decay"),
    sustain: document.getElementById("sustain"),
    release: document.getElementById("release"),
    cutoff: document.getElementById("cutoff"),
    resonance: document.getElementById("resonance"),
    volume: document.getElementById("volume"),
    octaveUp: document.getElementById("octave-up"),
    octaveDown: document.getElementById("octave-down"),
    keyboard: document.getElementById("keyboard"),
    recordBtn: document.getElementById("record-btn"),
    recordStatus: document.getElementById("record-status"),
    recordings: document.getElementById("recordings"),
    audioWarning: document.getElementById("audio-warning"),
  };

  function bindValueDisplay(id, format) {
    const input = els[id];
    const out = document.querySelector(`.value[data-for="${id}"]`);
    const update = () => (out.textContent = format(parseFloat(input.value)));
    input.addEventListener("input", update);
    update();
  }
  bindValueDisplay("attack", (v) => `${v.toFixed(3)}s`);
  bindValueDisplay("decay", (v) => `${v.toFixed(3)}s`);
  bindValueDisplay("sustain", (v) => v.toFixed(2));
  bindValueDisplay("release", (v) => `${v.toFixed(3)}s`);
  bindValueDisplay("cutoff", (v) => `${Math.round(v)}Hz`);
  bindValueDisplay("resonance", (v) => v.toFixed(1));
  bindValueDisplay("volume", (v) => `${Math.round(v * 100)}%`);

  // ---- Audio engine ----
  class SynthEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.recordDest = null;
      this.voices = new Map(); // note -> { osc, voiceGain, filter }
      this.octave = 4;
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
      this.masterGain.connect(this.ctx.destination);

      // Recording tap: always connected so MediaRecorder can start capturing
      // instantly, independent of whether a note is currently playing.
      if (this.ctx.createMediaStreamDestination) {
        this.recordDest = this.ctx.createMediaStreamDestination();
        this.masterGain.connect(this.recordDest);
      }

      if (this.ctx.state === "suspended") this.ctx.resume();
    }

    setVolume(v) {
      if (this.masterGain) this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    }

    noteOn(note) {
      this.ensureContext();
      if (this.voices.has(note)) return;

      const ctx = this.ctx;
      const now = ctx.currentTime;
      const freq = 440 * Math.pow(2, (note - 69) / 12);

      const osc = ctx.createOscillator();
      osc.type = els.waveform.value;
      osc.frequency.value = freq;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = parseFloat(els.cutoff.value);
      filter.Q.value = parseFloat(els.resonance.value);

      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0;

      osc.connect(filter);
      filter.connect(voiceGain);
      voiceGain.connect(this.masterGain);

      const attack = parseFloat(els.attack.value);
      const decay = parseFloat(els.decay.value);
      const sustain = parseFloat(els.sustain.value);
      const peak = 0.28; // per-voice headroom so chords don't clip

      voiceGain.gain.cancelScheduledValues(now);
      voiceGain.gain.setValueAtTime(0, now);
      voiceGain.gain.linearRampToValueAtTime(peak, now + attack);
      voiceGain.gain.linearRampToValueAtTime(peak * sustain, now + attack + decay);

      osc.start(now);
      this.voices.set(note, { osc, voiceGain, filter });
    }

    noteOff(note) {
      const voice = this.voices.get(note);
      if (!voice) return;
      this.voices.delete(note);

      const ctx = this.ctx;
      const now = ctx.currentTime;
      const release = parseFloat(els.release.value);
      const { osc, voiceGain } = voice;

      const current = voiceGain.gain.value;
      voiceGain.gain.cancelScheduledValues(now);
      voiceGain.gain.setValueAtTime(current, now);
      voiceGain.gain.linearRampToValueAtTime(0, now + release);

      osc.stop(now + release + 0.02);
      osc.addEventListener("ended", () => {
        osc.disconnect();
        voiceGain.disconnect();
        voice.filter.disconnect();
      });
    }

    updateFilterForActiveVoices() {
      if (!this.ctx) return;
      const cutoff = parseFloat(els.cutoff.value);
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
  els.cutoff.addEventListener("input", () => synth.updateFilterForActiveVoices());
  els.resonance.addEventListener("input", () => synth.updateFilterForActiveVoices());

  // ---- Octave control ----
  function setOctave(delta) {
    synth.octave = Math.min(7, Math.max(1, synth.octave + delta));
    document.querySelector('.value[data-for="octave"]').textContent = synth.octave;
  }
  els.octaveUp.addEventListener("click", () => setOctave(1));
  els.octaveDown.addEventListener("click", () => setOctave(-1));

  function noteForOffset(offset) {
    return (synth.octave + 1) * 12 + offset; // MIDI note number, C4 = 60
  }

  // ---- Visual keyboard ----
  const keyEls = new Map(); // offset -> element

  function buildKeyboard() {
    els.keyboard.innerHTML = "";
    WHITE_OFFSETS.forEach((offset) => {
      const key = document.createElement("div");
      key.className = "key white";
      key.dataset.offset = offset;
      els.keyboard.appendChild(key);
      keyEls.set(offset, key);
    });

    const whiteWidth = 100 / WHITE_OFFSETS.length;
    let whiteIndex = 0;
    BLACK_OFFSETS.forEach((offset) => {
      if (offset === null) {
        whiteIndex += 1;
        return;
      }
      const key = document.createElement("div");
      key.className = "key black";
      key.dataset.offset = offset;
      key.style.left = `${whiteWidth * (whiteIndex + 1) - 2.75}%`;
      els.keyboard.appendChild(key);
      keyEls.set(offset, key);
      whiteIndex += 1;
    });
  }
  buildKeyboard();

  function pressOffset(offset) {
    const note = noteForOffset(offset);
    synth.noteOn(note);
    const el = keyEls.get(offset);
    if (el) el.classList.add("active");
  }
  function releaseOffset(offset) {
    const note = noteForOffset(offset);
    synth.noteOff(note);
    const el = keyEls.get(offset);
    if (el) el.classList.remove("active");
  }

  // Pointer interaction (mouse + touch) on the keyboard
  let pointerDown = false;
  let activePointerOffset = null;

  function offsetFromEvent(e) {
    const target = e.target.closest(".key");
    return target ? parseInt(target.dataset.offset, 10) : null;
  }

  els.keyboard.addEventListener("pointerdown", (e) => {
    const offset = offsetFromEvent(e);
    if (offset === null) return;
    pointerDown = true;
    activePointerOffset = offset;
    pressOffset(offset);
  });
  els.keyboard.addEventListener("pointerover", (e) => {
    if (!pointerDown) return;
    const offset = offsetFromEvent(e);
    if (offset === null || offset === activePointerOffset) return;
    if (activePointerOffset !== null) releaseOffset(activePointerOffset);
    activePointerOffset = offset;
    pressOffset(offset);
  });
  document.addEventListener("pointerup", () => {
    if (activePointerOffset !== null) releaseOffset(activePointerOffset);
    pointerDown = false;
    activePointerOffset = null;
  });
  els.keyboard.addEventListener("pointerleave", (e) => {
    if (pointerDown && e.target === els.keyboard && activePointerOffset !== null) {
      releaseOffset(activePointerOffset);
      activePointerOffset = null;
    }
  });
  els.keyboard.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---- Computer keyboard interaction ----
  const heldKeys = new Set();
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "z") return setOctave(-1);
    if (key === "x") return setOctave(1);
    if (!(key in KEY_TO_OFFSET)) return;
    if (heldKeys.has(key)) return;
    heldKeys.add(key);
    pressOffset(KEY_TO_OFFSET[key]);
  });
  window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    if (!heldKeys.has(key)) return;
    heldKeys.delete(key);
    releaseOffset(KEY_TO_OFFSET[key]);
  });

  // ---- Recording ----
  const RecorderState = {
    recorder: null,
    chunks: [],
    startedAt: 0,
    timerId: null,
  };

  function pickMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
  }

  function extensionFor(mimeType) {
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("mp4")) return "m4a";
    return "dat";
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function startRecording() {
    synth.ensureContext();
    if (!synth.recordDest) {
      els.audioWarning.hidden = false;
      return;
    }
    const mimeType = pickMimeType();
    if (!window.MediaRecorder || !mimeType) {
      els.audioWarning.hidden = false;
      return;
    }

    RecorderState.chunks = [];
    const recorder = new MediaRecorder(synth.recordDest.stream, { mimeType });
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) RecorderState.chunks.push(e.data);
    });
    recorder.addEventListener("stop", () => {
      const blob = new Blob(RecorderState.chunks, { type: mimeType });
      addRecording(blob, mimeType);
    });

    // Request periodic dataavailable events so recordings survive an abrupt
    // tab close and aren't stuck waiting for one final flush.
    recorder.start(250);
    RecorderState.recorder = recorder;
    RecorderState.startedAt = Date.now();

    els.recordBtn.classList.add("recording");
    els.recordBtn.lastChild.textContent = " Stop";
    RecorderState.timerId = setInterval(() => {
      els.recordStatus.textContent = `Recording ${formatElapsed(Date.now() - RecorderState.startedAt)}`;
    }, 200);
  }

  function stopRecording() {
    if (!RecorderState.recorder || RecorderState.recorder.state === "inactive") return;
    RecorderState.recorder.stop();
    clearInterval(RecorderState.timerId);
    RecorderState.timerId = null;
    els.recordBtn.classList.remove("recording");
    els.recordBtn.lastChild.textContent = " Record";
    els.recordStatus.textContent = "Not recording";
  }

  els.recordBtn.addEventListener("click", () => {
    const isRecording = RecorderState.recorder && RecorderState.recorder.state === "recording";
    if (isRecording) stopRecording();
    else startRecording();
  });

  function addRecording(blob, mimeType) {
    const url = URL.createObjectURL(blob);
    const ext = extensionFor(mimeType);
    const timestamp = new Date();
    const filename = `synthowser-${timestamp.toISOString().replace(/[:.]/g, "-")}.${ext}`;

    const li = document.createElement("li");

    const name = document.createElement("span");
    name.className = "rec-name";
    name.textContent = timestamp.toLocaleTimeString();

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = url;

    const download = document.createElement("a");
    download.href = url;
    download.download = filename;
    download.textContent = "Download";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      URL.revokeObjectURL(url);
      li.remove();
    });

    li.append(name, audio, download, del);
    els.recordings.prepend(li);
  }

  if (!window.MediaRecorder) {
    els.audioWarning.hidden = false;
  }
})();
