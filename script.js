const WHITE_LAYOUT = [
  ["`", 0], ["q", 2], ["w", 4], ["e", 5], ["r", 7], ["t", 9], ["y", 11],
  ["u", 12], ["i", 14], ["o", 16], ["p", 17], ["[", 19], ["]", 21], ["\\", 23],
  ["a", 24], ["s", 26], ["d", 28], ["f", 29], ["g", 31], ["h", 33], ["j", 35],
  ["k", 36], ["l", 38], [";", 40], ["'", 41]
].map(([key, offset]) => ({ key, offset }));

const BLACK_LAYOUT = [
  ["1", 0, 1], ["2", 1, 3], ["4", 3, 6], ["5", 4, 8], ["6", 5, 10],
  ["8", 7, 13], ["9", 8, 15], ["-", 10, 18], ["=", 11, 20], ["3", 12, 22],
  ["7", 14, 25], ["0", 15, 27], ["z", 17, 30], ["x", 18, 32], ["c", 19, 34],
  ["v", 21, 37]
].map(([key, afterWhite, offset]) => ({ key, afterWhite, offset }));

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NATURAL_NOTES = { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B" };

let octave = 4;
let transpose = 0;
let sustain = false;
let started = false;
let instrumentsReady = false;
let currentInstrumentName = "piano";
let instrument = null;
let activeKeys = new Map();
let activeKeyInstruments = new Map();
let heldVoiceTimers = new Map();
let heldVoices = new Map();
let heldKeys = new Set();

const piano = document.getElementById("piano");
const startAudioBtn = document.getElementById("startAudio");

const reverb = new Tone.Reverb({ decay: 2.4, wet: 0.10 }).toDestination();
const limiter = new Tone.Limiter(-0.8).connect(reverb);
const echo = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.35, wet: 0 }).connect(limiter);
const compressor = new Tone.Compressor({ threshold: -22, ratio: 2.2, attack: 0.005, release: 0.12 }).connect(echo);
Tone.Destination.volume.value = 6;

const GM_BASE = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/";
const NOTE_FILE_MAP = {
  "C": "C", "C#": "Db", "D": "D", "D#": "Eb", "E": "E", "F": "F",
  "F#": "Gb", "G": "G", "G#": "Ab", "A": "A", "A#": "Bb", "B": "B"
};

function makeFluidSampler(slug, volume = 3, release = 0.65, soundfont = "FluidR3_GM") {
  const urls = {};
  const octaves = [2, 3, 4, 5, 6];
  const notes = ["C", "D#", "F#", "A"];

  notes.forEach(note => {
    octaves.forEach(oct => {
      urls[note + oct] = NOTE_FILE_MAP[note] + oct + ".mp3";
    });
  });

  urls["C7"] = "C7.mp3";

  return new Tone.Sampler({
    urls,
    baseUrl: `${GM_BASE.replace("FluidR3_GM", soundfont)}${slug}-mp3/`,
    release,
    volume
  }).connect(compressor);
}

const sampledInstruments = {
  piano: () => new Tone.Sampler({
    urls: {
      A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3", A1: "A1.mp3",
      C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3",
      C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3",
      C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", A4: "A4.mp3",
      C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
      C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3", A6: "A6.mp3",
      C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3", A7: "A7.mp3", C8: "C8.mp3"
    },
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    // Salamander is a multi-sampled concert piano. A longer release keeps
    // the recorded tail natural after key-up; the samples still ring while held.
    release: 2.2,
    volume: 7
  }).connect(compressor),

  harmonium: () => makeFluidSampler("reed_organ", 7, 0.45),
  flute: () => makeFluidSampler("flute", 8, 0.45),
  strings: () => makeFluidSampler("string_ensemble_1", 5, 0.75),
  guitar: () => makeFluidSampler("acoustic_guitar_nylon", 8, 0.35),
  // MusyngKite has a fuller, more resonant sitar multisample than the basic
  // FluidR3 patch. It is CC BY-SA 3.0; see the soundfont project README.
  sitar: () => makeFluidSampler("sitar", 9, 0.8, "MusyngKite"),
  violin: () => makeFluidSampler("violin", 6, 0.75),
};

const synthPresets = {
  synth: () => new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 32,
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.018, decay: 0.16, sustain: 0.62, release: 0.28 },
    volume: 2
  }).connect(compressor),

};

// Sample recordings have finite length. This quiet sustain layer keeps a key
// audible beyond the recording tail while preserving the sampled attack.
const sustainLayer = new Tone.PolySynth(Tone.Synth, {
  maxPolyphony: 32,
  oscillator: { type: "sine" },
  envelope: { attack: 0.12, decay: 0, sustain: 1, release: 0.18 },
  volume: -25
}).connect(compressor);

// --- Preloading: every instrument is built once up front so switching later is instant ---
const instrumentCache = {};

function buildAllInstruments() {
  Object.keys(sampledInstruments).forEach(name => {
    instrumentCache[name] = sampledInstruments[name]();
  });
  Object.keys(synthPresets).forEach(name => {
    instrumentCache[name] = synthPresets[name]();
  });
}

function setControlsEnabled(enabled) {
  document.querySelectorAll(".inst-btn").forEach(b => { b.disabled = !enabled; });
  startAudioBtn.disabled = !enabled;
}

function initInstruments() {
  setControlsEnabled(false);
  startAudioBtn.textContent = "Loading…";

  buildAllInstruments();
  instrument = instrumentCache[currentInstrumentName];

  Tone.loaded().then(() => {
    instrumentsReady = true;
    setControlsEnabled(true);
    startAudioBtn.textContent = "Start Audio";
  }).catch(err => {
    console.error("Instrument loading failed:", err);
    startAudioBtn.textContent = "Load failed - retry";
    startAudioBtn.disabled = false;
  });
}

async function startAudio() {
  if (!instrumentsReady) return;
  await Tone.start();
  started = true;
  startAudioBtn.style.display = "none";
}

function setInstrument(name) {
  if (!instrumentCache[name]) return;
  stopAll();
  currentInstrumentName = name;
  instrument = instrumentCache[name];
}

const INSTRUMENT_SHORTCUTS = {
  "1": "piano", "2": "harmonium", "3": "flute", "4": "strings",
  "5": "guitar", "6": "sitar", "7": "synth", "8": "violin"
};

function selectInstrument(name) {
  if (!instrumentCache[name]) return;
  document.querySelectorAll(".inst-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.inst === name);
  });
  setInstrument(name);
}

function midiToNote(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[pc] + oct;
}

function noteFromOffset(offset) {
  return midiToNote(12 * (octave + 1) + offset + transpose);
}

function normalizeKey(key) {
  return key.length === 1 ? key.toLowerCase() : key;
}

function cssEscape(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function playKey(key) {
  key = normalizeKey(key);
  if (!started || !instrument || activeKeys.has(key)) return;

  const el = document.querySelector(`[data-key="${cssEscape(key)}"]`);
  if (!el) return;

  const note = noteFromOffset(Number(el.dataset.offset));
  activeKeys.set(key, note);
  activeKeyInstruments.set(key, instrument);
  heldKeys.add(key);
  el.classList.add("active");

  instrument.triggerAttack(note, Tone.now(), 1);
  const timer = setTimeout(() => {
    heldVoiceTimers.delete(key);
    if ((!heldKeys.has(key) && !sustain) || !activeKeys.has(key)) return;
    heldVoices.set(key, note);
    sustainLayer.triggerAttack(note, Tone.now(), 0.35);
  }, 1400);
  heldVoiceTimers.set(key, timer);
}

function releaseKey(key) {
  key = normalizeKey(key);
  if (!activeKeys.has(key)) return;

  heldKeys.delete(key);
  if (sustain) return;
  clearTimeout(heldVoiceTimers.get(key));
  heldVoiceTimers.delete(key);

  const note = activeKeys.get(key);
  activeKeys.delete(key);

  const el = document.querySelector(`[data-key="${cssEscape(key)}"]`);
  if (el) el.classList.remove("active");

  activeKeyInstruments.get(key)?.triggerRelease(note, Tone.now());
  activeKeyInstruments.delete(key);
  if (heldVoices.has(key)) {
    sustainLayer.triggerRelease(heldVoices.get(key), Tone.now());
    heldVoices.delete(key);
  }
}

function releaseSustainedKeys() {
  [...activeKeys.entries()].forEach(([key, note]) => {
    if (!heldKeys.has(key)) {
      activeKeys.delete(key);
      const el = document.querySelector(`[data-key="${cssEscape(key)}"]`);
      if (el) el.classList.remove("active");
      activeKeyInstruments.get(key)?.triggerRelease(note, Tone.now());
      activeKeyInstruments.delete(key);
      if (heldVoices.has(key)) {
        sustainLayer.triggerRelease(heldVoices.get(key), Tone.now());
        heldVoices.delete(key);
      }
    }
  });
}

function stopAll() {
  activeKeys.forEach((note) => {
    try { instrument?.triggerRelease(note, Tone.now()); } catch {}
  });

  activeKeys.clear();
  activeKeyInstruments.clear();
  heldVoiceTimers.forEach(timer => clearTimeout(timer));
  heldVoiceTimers.clear();
  heldVoices.forEach(note => sustainLayer.triggerRelease(note, Tone.now()));
  heldVoices.clear();
  heldKeys.clear();

  document.querySelectorAll(".active").forEach(el => el.classList.remove("active"));

  // Belt-and-suspenders: release every voice on every loaded instrument,
  // not just the currently active one, so nothing is ever left hanging
  // after an instrument switch, a panic click, or losing focus.
  Object.values(instrumentCache).forEach(inst => {
    try { inst?.releaseAll?.(); } catch {}
  });
  try { instrument?.releaseAll?.(); } catch {}
}

function updateLabels() {
  document.querySelectorAll("[data-offset]").forEach(el => {
    const baseOffset = Number(el.dataset.offset);
    const pc = ((baseOffset % 12) + 12) % 12;

    const noteEl = el.querySelector(".note-name");
    if (noteEl && el.classList.contains("white")) noteEl.textContent = NATURAL_NOTES[pc];

    const sharpEl = el.querySelector(".sharp");
    if (sharpEl) sharpEl.textContent = NOTE_NAMES[pc].replace("#", "♯");
  });

  document.getElementById("octaveValue").textContent = octave;
  document.getElementById("transposeValue").textContent = transpose;
}

function buildPiano() {
  piano.innerHTML = "";

  WHITE_LAYOUT.forEach(item => {
    const el = document.createElement("div");
    el.className = "white";
    el.dataset.key = item.key;
    el.dataset.offset = item.offset;
    el.innerHTML = `<span class="key-name">${item.key}</span><span class="note-name"></span>`;
    piano.appendChild(el);
  });

  BLACK_LAYOUT.forEach(item => {
    const el = document.createElement("div");
    el.className = "black";
    el.dataset.key = item.key;
    el.dataset.offset = item.offset;
    el.style.left = `${16 + (item.afterWhite + 1) * 72 - 21}px`;
    el.innerHTML = `<span>${item.key}</span><span class="sharp"></span>`;
    piano.appendChild(el);
  });

  piano.querySelectorAll("[data-key]").forEach(el => {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      playKey(el.dataset.key);
    });
    el.addEventListener("pointerup", (e) => {
      e.preventDefault();
      releaseKey(el.dataset.key);
    });
    el.addEventListener("pointercancel", () => releaseKey(el.dataset.key));
    el.addEventListener("lostpointercapture", () => releaseKey(el.dataset.key));
  });

  updateLabels();
}

document.addEventListener("keydown", (e) => {
  const shortcutNumber = e.code.startsWith("Digit") ? e.code.slice(5) : e.key;
  if (e.shiftKey && INSTRUMENT_SHORTCUTS[shortcutNumber]) {
    e.preventDefault();
    if (!instrumentsReady) return;
    if (!started) startAudio().then(() => selectInstrument(INSTRUMENT_SHORTCUTS[shortcutNumber]));
    else selectInstrument(INSTRUMENT_SHORTCUTS[shortcutNumber]);
    return;
  }
  // Arrow keys: transpose (up/down) and octave (left/right).
  // Handled before the repeat check so holding an arrow steps continuously.
  if (e.key === "ArrowUp") {
    e.preventDefault();
    transpose = Math.min(12, transpose + 1);
    updateLabels();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    transpose = Math.max(-12, transpose - 1);
    updateLabels();
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    octave = Math.max(1, octave - 1);
    updateLabels();
    return;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    octave = Math.min(7, octave + 1);
    updateLabels();
    return;
  }

  if (e.repeat) return;

  if (e.key === " ") {
    sustain = true;
    document.getElementById("sustain").checked = true;
    e.preventDefault();
    return;
  }

  playKey(e.key);
});

document.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    sustain = document.getElementById("sustain").checked;
    if (!sustain) releaseSustainedKeys();
    e.preventDefault();
    return;
  }

  releaseKey(e.key);
});

window.addEventListener("blur", stopAll);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopAll();
});

startAudioBtn.addEventListener("click", startAudio);

document.querySelectorAll(".inst-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (!instrumentsReady) return;
    if (!started) await startAudio();

    selectInstrument(btn.dataset.inst);
  });
});

document.getElementById("volume").addEventListener("input", e => {
  Tone.Destination.volume.value = Number(e.target.value);
});

document.getElementById("reverb").addEventListener("input", e => {
  reverb.wet.value = Number(e.target.value);
});

document.getElementById("echo").addEventListener("input", e => {
  echo.wet.value = Number(e.target.value);
});

document.getElementById("sustain").addEventListener("change", e => {
  sustain = e.target.checked;
  if (!sustain) releaseSustainedKeys();
});

document.getElementById("octDown").addEventListener("click", () => {
  octave = Math.max(1, octave - 1);
  updateLabels();
});

document.getElementById("octUp").addEventListener("click", () => {
  octave = Math.min(7, octave + 1);
  updateLabels();
});

document.getElementById("transDown").addEventListener("click", () => {
  transpose = Math.max(-12, transpose - 1);
  updateLabels();
});

document.getElementById("transUp").addEventListener("click", () => {
  transpose = Math.min(12, transpose + 1);
  updateLabels();
});

document.getElementById("panic").addEventListener("click", stopAll);

buildPiano();
initInstruments();
