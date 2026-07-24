# Headless-DAW

A polyphonic synthesizer that runs entirely in the browser, built with the Web Audio API — no build step, no dependencies.

## Features

- Sawtooth / square / triangle / sine oscillator
- ADSR envelope (attack, decay, sustain, release)
- Resonant low-pass filter
- On-screen piano keyboard (mouse/touch, supports chords and glissando drag)
- Computer-keyboard playing: `A W S E D F T G Y H U J K O L` map to white/black keys, `Z`/`X` shift octaves
- Recording: capture whatever you play and export it as a downloadable audio file

## Running it

Any static file server works, e.g.:

```sh
python3 -m http.server 8000
```

then open `http://localhost:8000`. Recording (`MediaRecorder`) requires a secure context, so use `localhost` or HTTPS — it will not work from a plain `file://` URL in most browsers.

## Recording notes

The synth's output is tapped into a `MediaStreamAudioDestinationNode` that stays connected to the master gain at all times, so pressing **Record** starts capturing immediately with no dropped audio at the start of a take. Recordings are listed with playback, download, and delete controls; downloads use `.webm` (or `.ogg`/`.m4a` depending on browser codec support).
