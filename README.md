# Pulseprint v1

Pulseprint is a local-first browser laboratory for finding recurring spectrotemporal structures in microphone recordings or imported audio. It keeps the raw evidence visible, exposes each preprocessing operation, proposes sound events with non-negative matrix factorization (NMF), associates normalized event patches into persistent structure tracks, and maintains multiple period/phase hypotheses for each track.

Audio never leaves the browser.

## v1 analysis pipeline

1. A 2048-sample Hann-windowed linear-frequency STFT is computed with a 512-sample hop.
2. An explicit STFT-domain band-pass taper is applied. The user chooses high-pass and low-pass cutoffs, transition width in octaves, and a rectangular, Hann, Hamming, or Blackman edge window.
3. An optional sampled room profile is subtracted per frequency bin.
4. An optional adaptive flux or adaptive magnitude residual floor is applied.
5. Each log-frequency inspection bin is robustly normalized with its median and median absolute deviation, producing a soft significance field.
6. Multiplicative-update NMF proposes latent spectral structures and temporal activations.
7. Fixed-size spectrogram patches are energy-normalized and compared with shift-tolerant normalized correlation.
8. Candidate, confirmed, and dormant track hypotheses are retained for the entire observation. Low-uncertainty timing hypotheses are considered first; sufficiently strong structure correlation can recover dormant tracks.
9. Mean-centered autocorrelation, inter-onset intervals, and phase folding provide global period evidence. Every selected period/phase pair can be overlaid, folded, and auditioned.

The floating processing window is deliberately persistent. Changes reanalyze the same captured PCM so their effects appear immediately in the significance field and structure bank.

## Run locally

Requirements:

- Node.js 22.13 or newer
- npm
- A secure browser origin for microphone access (`localhost` is accepted by modern browsers)

```bash
npm ci
npm run dev
```

For the production artifact:

```bash
npm run build
npm run start
```

## Important files

- `app/pulseprint-core.tsx` — responsive UI, microphone/audio capture, QC playback, interactive fold selection, and diagnostics.
- `app/pulseprint-dsp.ts` — FFT, preprocessing, room/background models, significance field, NMF, event proposals, association, and period estimation.
- `app/pulseprint-period.tsx` — pulse-grid overlays and folded visualizations.
- `app/core.css` and `app/tracker.css` — touch-first analysis interface.
- `app/layout.tsx` — site metadata.

## Interpretation notes

- A pulse rate in cycles per minute is not automatically a musical tempo.
- NMF rank is a model-order hypothesis, not a known source count.
- QC event playback is a time crop with an approximate Web Audio band-pass; it is not phase-aware source separation.
- Same/different labels are exported as supervision but do not yet refit the association model.
- The structure bank currently persists for one captured observation, not between browser sessions.
- The STFT band-pass operates on magnitude before background modeling. It is an analysis filter, not a linear-phase waveform reconstruction filter.

## Diagnostic schema

v1 exports `pulseprint-structure-tracking-v1.0`, including:

- band-pass cutoffs, taper window, and transition width;
- room and residual background parameters;
- NMF configuration and reconstruction error;
- event time/frequency bounds and association evidence;
- track histories and competing period hypotheses;
- the selected fold hypothesis and residual-memory-to-period ratio;
- user same/different labels.

Pulseprint is an experimental analysis instrument. The intent is to make algorithmic uncertainty inspectable before adding learned segmentation or source-specific models.
