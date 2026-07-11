SR Piano v4 - Preloaded Instruments

Changes in this version:
- All instruments (piano, harmonium, organ, flute, strings, guitar, synth, pad)
  are now built and loaded in the background as soon as the page opens, instead
  of being created on demand. Switching instruments is now instant with no
  reload or wait, since every sound engine already exists in memory.
- Loading is tracked with Tone.loaded(): the "Start Audio" button and all
  instrument buttons are disabled and show "Loading..." until every sample
  has finished downloading, then they enable automatically.
- New keyboard shortcuts:
    Arrow Up    = Transpose +
    Arrow Down  = Transpose -
    Arrow Left  = Octave -
    Arrow Right = Octave +
  Holding an arrow key steps continuously.
- Hardened "no hanging notes" behavior: releasing all voices on every loaded
  instrument (not just the active one) on instrument switch, Stop All, window
  blur, and tab-hide, so notes can never get stuck ringing.
- Same UI, layout, and playing-key layout as before (only the Start Audio
  button text/disabled state changes while loading).

Internet is required because sampled instruments load from:
- Tone.js CDN
- FluidR3 GM SoundFont CDN
- Salamander piano CDN

Open index.html in Chrome/Edge/Firefox. Wait for "Start Audio" to become
enabled (instruments are preloading), then click it or any instrument button
to begin playing.
