export type ResidualStrategy = "none" | "flux-ema" | "magnitude-ema";
export type BandpassWindow = "rectangular" | "hann" | "hamming" | "blackman";

export type PreprocessingConfig = {
  lowCutoff: number;
  highCutoff: number;
  transitionOctaves: number;
  window: BandpassWindow;
};

export type BackgroundConfig = {
  useRoomProfile: boolean;
  residualStrategy: ResidualStrategy;
  timeConstant: number;
  roomStrength: number;
  residualStrength: number;
};

export type Band = { name: string; low: number; high: number; color: string };
export type NoiseProfile = {
  id: string;
  sampleRate: number;
  fftSize: number;
  duration: number;
  rms: number;
  values: number[];
};
export type AppliedConfig = {
  rateRange: [number, number];
  analysisRange: [number, number];
  bands: Band[];
  preprocessing: PreprocessingConfig;
  background: BackgroundConfig;
  noiseProfile: NoiseProfile | null;
  decompositionRank: number;
  detectionSigma: number;
};

export type MethodPoint = { rate: number; acf: number; ioi: number; fold: number; fused: number; phase: number };
export type Candidate = MethodPoint & { period: number; cycles: number; relation: string };
export type PeriodHypothesis = { periodSeconds: number; rateCyclesPerMinute: number; phaseSeconds: number; score: number; uncertaintySeconds: number };
export type EventProposal = {
  id: string;
  trackId: string;
  component: number;
  timeSeconds: number;
  startSeconds: number;
  endSeconds: number;
  lowHz: number;
  highHz: number;
  amplitude: number;
  spectralCentroidHz: number;
  associationSimilarity: number;
  timingInnovationSeconds: number | null;
  descriptor: number[][];
};
export type StructureTrack = {
  id: string;
  color: string;
  state: "candidate" | "confirmed" | "dormant";
  eventIds: string[];
  prototype: number[][];
  templateCoherence: number;
  meanAmplitude: number;
  lastSeenSeconds: number;
  periodHypotheses: PeriodHypothesis[];
};
export type DecompositionSummary = { rank: number; iterations: number; normalizedError: number; temporalStride: number };

export type Analysis = {
  configUsed: AppliedConfig;
  duration: number;
  sampleRate: number;
  fftSize: number;
  hopSize: number;
  computeMs: number;
  status: "sufficient" | "insufficient";
  waterfall: number[][];
  foregroundWaterfall: number[][];
  significanceWaterfall: number[][];
  novelty: number[][];
  peaks: number[][];
  methods: MethodPoint[];
  candidates: Candidate[];
  phaseMap: number[][];
  phaseRates: number[];
  bestRate: number;
  bestPhase: number;
  noiseFloor: number;
  peak: number;
  rms: number;
  retainedFraction: number;
  bandpassRetainedFraction: number;
  events: EventProposal[];
  tracks: StructureTrack[];
  decomposition: DecompositionSummary;
};

export const COLORS = ["#ffb45f", "#ff6fab", "#62e6ff"];
export const FOCUS_COLORS = ["#a98bff", "#7fffb2", "#ffdc5e", "#ff8f72"];
export const TRACK_COLORS = ["#c9ff72", "#62e6ff", "#ff6fab", "#ffb45f", "#a98bff", "#7fffb2", "#ffdc5e", "#ff8f72"];
export const NAMES = ["Low", "Mid", "High"];
export const FREQ_MIN = 35;
export const FREQ_MAX = 18000;
export const FREQ_TICKS = [18000, 10000, 5000, 2500, 1000, 500, 100, 35];
const FFT_SIZE = 2048;
const HOP_SIZE = 512;
const DISPLAY_BINS = 72;
const PATCH_FRAMES = 13;

export const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
export const quantile = (values: number[], q: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
export const normalize = (values: number[]) => {
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(1e-9, hi - lo);
  return values.map((value) => (value - lo) / span);
};
export const hzPosition = (hz: number) => 100 * (1 - Math.log(hz / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN));
export const positionHz = (position: number) => FREQ_MAX * Math.pow(FREQ_MIN / FREQ_MAX, Math.max(0, Math.min(1, position)));
export const formatHz = (hz: number) => hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 ? 1 : 0)}k` : `${Math.round(hz)}`;
export const residualLabel = (strategy: ResidualStrategy) => strategy === "none" ? "Residual adaptation OFF" : strategy === "magnitude-ema" ? "Adaptive residual spectrum" : "Adaptive residual flux";

const taper = (u: number, window: BandpassWindow) => {
  const x = Math.max(0, Math.min(1, u));
  if (window === "rectangular") return x >= 1 ? 1 : 0;
  if (window === "hann") return 0.5 - 0.5 * Math.cos(Math.PI * x);
  if (window === "hamming") return Math.max(0, (0.54 - 0.46 * Math.cos(Math.PI * x) - 0.08) / 0.92);
  return Math.max(0, 0.42 - 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x));
};

export function bandpassWeight(hz: number, config: PreprocessingConfig) {
  const transition = Math.max(0, config.transitionOctaves);
  if (config.window === "rectangular" || transition < 1e-4) return hz >= config.lowCutoff && hz <= config.highCutoff ? 1 : 0;
  const lowStart = config.lowCutoff / Math.pow(2, transition), highEnd = config.highCutoff * Math.pow(2, transition);
  if (hz <= lowStart || hz >= highEnd) return 0;
  const lowWeight = hz >= config.lowCutoff ? 1 : taper(Math.log2(hz / lowStart) / transition, config.window);
  const highWeight = hz <= config.highCutoff ? 1 : taper(Math.log2(highEnd / hz) / transition, config.window);
  return Math.max(0, Math.min(1, lowWeight * highWeight));
}

export function bandpassSupport(config: PreprocessingConfig): [number, number] {
  if (config.window === "rectangular" || config.transitionOctaves < 1e-4) return [config.lowCutoff, config.highCutoff];
  return [Math.max(FREQ_MIN, config.lowCutoff / Math.pow(2, config.transitionOctaves)), Math.min(FREQ_MAX, config.highCutoff * Math.pow(2, config.transitionOctaves))];
}

function spectrum(pcm: Float32Array, offset: number, n: number, maxBin: number) {
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i += 1) re[i] = (pcm[offset + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const swap = re[i]; re[i] = re[j]; re[j] = swap; }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    for (let start = 0; start < n; start += length) for (let j = 0; j < length / 2; j += 1) {
      const cosine = Math.cos(angle * j), sine = Math.sin(angle * j);
      const ur = re[start + j], ui = im[start + j];
      const vr = re[start + j + length / 2] * cosine - im[start + j + length / 2] * sine;
      const vi = re[start + j + length / 2] * sine + im[start + j + length / 2] * cosine;
      re[start + j] = ur + vr; im[start + j] = ui + vi;
      re[start + j + length / 2] = ur - vr; im[start + j + length / 2] = ui - vi;
    }
  }
  return Array.from({ length: maxBin }, (_, i) => Math.log1p(Math.hypot(re[i], im[i])));
}

export function estimateNoiseProfile(pcm: Float32Array, sampleRate: number): NoiseProfile {
  const n = FFT_SIZE, hop = HOP_SIZE, maxBin = Math.min(n / 2, Math.ceil(FREQ_MAX / (sampleRate / n))), frames: number[][] = [];
  for (let offset = 0; offset + n < pcm.length; offset += hop) frames.push(spectrum(pcm, offset, n, maxBin));
  const values = Array.from({ length: maxBin }, (_, bin) => quantile(frames.map((frame) => frame[bin]), 0.8));
  let hash = 2166136261, square = 0;
  values.forEach((value) => { hash ^= Math.round(value * 10000); hash = Math.imul(hash, 16777619); });
  for (const value of pcm) square += value * value;
  return { id: `room-${(hash >>> 0).toString(16)}`, sampleRate, fftSize: n, duration: pcm.length / sampleRate, rms: Math.sqrt(square / Math.max(1, pcm.length)), values };
}

function processSpectrum(magnitudes: number[][], hopSeconds: number, sampleRate: number, fftSize: number, preprocessing: PreprocessingConfig, config: BackgroundConfig, profile: NoiseProfile | null) {
  const bins = magnitudes[0]?.length ?? 0;
  const output = magnitudes.map(() => new Float32Array(bins));
  const roomAdjusted = magnitudes.map(() => new Float32Array(bins));
  const alpha = 1 - Math.exp(-hopSeconds / Math.max(0.08, config.timeConstant));
  const fluxFloor = new Float32Array(bins), magnitudeFloor = new Float32Array(bins);
  let rawTotal = 0, filteredTotal = 0, retainedTotal = 0;
  for (let t = 0; t < magnitudes.length; t += 1) for (let bin = 1; bin < bins; bin += 1) {
    const hz = bin * sampleRate / fftSize, weight = bandpassWeight(hz, preprocessing), rawValue = magnitudes[t][bin];
    let value = Math.log1p(weight * Math.expm1(rawValue));
    rawTotal += rawValue;
    filteredTotal += value;
    if (config.useRoomProfile && profile) {
      const profileBin = Math.min(profile.values.length - 1, Math.round(hz / (profile.sampleRate / profile.fftSize)));
      const filteredProfile = Math.log1p(weight * Math.expm1(profile.values[profileBin]));
      value = Math.max(0, value - config.roomStrength * filteredProfile);
    }
    roomAdjusted[t][bin] = value;
  }
  if (roomAdjusted.length) magnitudeFloor.set(roomAdjusted[0]);
  for (let t = 1; t < magnitudes.length; t += 1) for (let bin = 1; bin < bins; bin += 1) {
    const rise = Math.max(0, roomAdjusted[t][bin] - roomAdjusted[t - 1][bin]);
    let retained = rise;
    if (config.residualStrategy === "flux-ema") {
      retained = Math.max(0, rise - config.residualStrength * fluxFloor[bin]);
      fluxFloor[bin] += alpha * (rise - fluxFloor[bin]);
    } else if (config.residualStrategy === "magnitude-ema") {
      const foreground = Math.max(0, roomAdjusted[t][bin] - config.residualStrength * magnitudeFloor[bin]);
      retained = rise * foreground / Math.max(1e-9, roomAdjusted[t][bin]);
      magnitudeFloor[bin] += alpha * (roomAdjusted[t][bin] - magnitudeFloor[bin]);
    }
    output[t][bin] = retained;
    retainedTotal += retained;
  }
  let filteredRiseTotal = 0;
  for (let t = 1; t < roomAdjusted.length; t += 1) for (let bin = 1; bin < bins; bin += 1) filteredRiseTotal += Math.max(0, roomAdjusted[t][bin] - roomAdjusted[t - 1][bin]);
  return { output, retainedFraction: retainedTotal / Math.max(1e-9, filteredRiseTotal), bandpassRetainedFraction: filteredTotal / Math.max(1e-9, rawTotal) };
}

function buildSignificance(foreground: number[][]) {
  if (!foreground.length) return [] as number[][];
  const significance = foreground.map(() => new Array(foreground[0].length).fill(0));
  for (let f = 0; f < foreground[0].length; f += 1) {
    const column = foreground.map((frame) => frame[f]), center = median(column);
    const mad = Math.max(1e-6, median(column.map((value) => Math.abs(value - center))));
    for (let t = 0; t < foreground.length; t += 1) significance[t][f] = Math.min(12, Math.max(0, (foreground[t][f] - center) / (1.4826 * mad)));
  }
  return significance.map((row, t) => row.map((value, f) => {
    const temporal = (significance[t - 1]?.[f] ?? value) * 0.2 + value * 0.6 + (significance[t + 1]?.[f] ?? value) * 0.2;
    return ((significance[t]?.[f - 1] ?? temporal) * 0.15 + temporal * 0.7 + (significance[t]?.[f + 1] ?? temporal) * 0.15);
  }));
}

function nmf(significance: number[][], rank: number, iterations = 18) {
  const originalT = significance.length, frequencyBins = significance[0]?.length ?? 0;
  const stride = Math.max(1, Math.ceil(originalT / 720)), timeBins = Math.ceil(originalT / stride);
  const v = new Float32Array(timeBins * frequencyBins), timeEnergy = new Float32Array(timeBins), frequencyEnergy = new Float32Array(frequencyBins);
  for (let t = 0; t < timeBins; t += 1) for (let f = 0; f < frequencyBins; f += 1) {
    let value = 0;
    for (let source = t * stride; source < Math.min(originalT, (t + 1) * stride); source += 1) value = Math.max(value, significance[source][f]);
    value = Math.log1p(value);
    v[t * frequencyBins + f] = value; timeEnergy[t] += value; frequencyEnergy[f] += value;
  }
  const w = new Float32Array(frequencyBins * rank), h = new Float32Array(rank * timeBins), epsilon = 1e-7;
  const maxTime = Math.max(epsilon, ...timeEnergy), maxFrequency = Math.max(epsilon, ...frequencyEnergy);
  for (let f = 0; f < frequencyBins; f += 1) for (let r = 0; r < rank; r += 1) w[f * rank + r] = 0.05 + (frequencyEnergy[f] / maxFrequency) * (0.55 + 0.45 * Math.abs(Math.cos((f + 1) * (r + 2) * 0.37)));
  for (let r = 0; r < rank; r += 1) for (let t = 0; t < timeBins; t += 1) h[r * timeBins + t] = 0.05 + (timeEnergy[t] / maxTime) * (0.55 + 0.45 * Math.abs(Math.sin((t + 1) * (r + 1) * 0.19)));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const wtW = new Float32Array(rank * rank);
    for (let r = 0; r < rank; r += 1) for (let q = 0; q < rank; q += 1) for (let f = 0; f < frequencyBins; f += 1) wtW[r * rank + q] += w[f * rank + r] * w[f * rank + q];
    for (let r = 0; r < rank; r += 1) for (let t = 0; t < timeBins; t += 1) {
      let numerator = 0, denominator = epsilon;
      for (let f = 0; f < frequencyBins; f += 1) numerator += w[f * rank + r] * v[t * frequencyBins + f];
      for (let q = 0; q < rank; q += 1) denominator += wtW[r * rank + q] * h[q * timeBins + t];
      h[r * timeBins + t] *= numerator / denominator;
    }
    const hHt = new Float32Array(rank * rank);
    for (let r = 0; r < rank; r += 1) for (let q = 0; q < rank; q += 1) for (let t = 0; t < timeBins; t += 1) hHt[r * rank + q] += h[r * timeBins + t] * h[q * timeBins + t];
    for (let f = 0; f < frequencyBins; f += 1) for (let r = 0; r < rank; r += 1) {
      let numerator = 0, denominator = epsilon;
      for (let t = 0; t < timeBins; t += 1) numerator += v[t * frequencyBins + f] * h[r * timeBins + t];
      for (let q = 0; q < rank; q += 1) denominator += w[f * rank + q] * hHt[q * rank + r];
      w[f * rank + r] *= numerator / denominator;
    }
    for (let r = 0; r < rank; r += 1) {
      let norm = epsilon;
      for (let f = 0; f < frequencyBins; f += 1) norm += w[f * rank + r] ** 2;
      norm = Math.sqrt(norm);
      for (let f = 0; f < frequencyBins; f += 1) w[f * rank + r] /= norm;
      for (let t = 0; t < timeBins; t += 1) h[r * timeBins + t] *= norm;
    }
  }
  let error = 0, energy = epsilon;
  for (let t = 0; t < timeBins; t += 1) for (let f = 0; f < frequencyBins; f += 1) {
    let reconstructed = 0;
    for (let r = 0; r < rank; r += 1) reconstructed += w[f * rank + r] * h[r * timeBins + t];
    const value = v[t * frequencyBins + f]; error += (value - reconstructed) ** 2; energy += value ** 2;
  }
  return { w, h, rank, timeBins, frequencyBins, stride, iterations, error: Math.sqrt(error / energy) };
}

function descriptorAt(significance: number[][], center: number) {
  const descriptor = Array.from({ length: PATCH_FRAMES }, () => new Array(DISPLAY_BINS).fill(0));
  const half = Math.floor(PATCH_FRAMES / 2);
  let norm = 1e-8;
  for (let x = 0; x < PATCH_FRAMES; x += 1) for (let f = 0; f < DISPLAY_BINS; f += 1) {
    const value = Math.log1p(significance[Math.max(0, Math.min(significance.length - 1, center + x - half))]?.[f] ?? 0);
    descriptor[x][f] = value; norm += value * value;
  }
  norm = Math.sqrt(norm);
  descriptor.forEach((row) => row.forEach((value, f) => { row[f] = value / norm; }));
  return descriptor;
}

export function descriptorSimilarity(first: number[][], second: number[][]) {
  let best = 0;
  for (let timeShift = -1; timeShift <= 1; timeShift += 1) for (let frequencyShift = -4; frequencyShift <= 4; frequencyShift += 1) {
    let dot = 0, aEnergy = 1e-9, bEnergy = 1e-9;
    for (let x = 0; x < first.length; x += 1) {
      const otherX = x + timeShift; if (otherX < 0 || otherX >= second.length) continue;
      for (let f = 0; f < first[x].length; f += 1) {
        const otherF = f + frequencyShift; if (otherF < 0 || otherF >= second[otherX].length) continue;
        const a = first[x][f], b = second[otherX][otherF]; dot += a * b; aEnergy += a * a; bEnergy += b * b;
      }
    }
    best = Math.max(best, dot / Math.sqrt(aEnergy * bEnergy));
  }
  return best;
}

function blendPrototype(prototype: number[][], observation: number[][], count: number) {
  const weight = Math.min(0.3, 1 / Math.max(2, count));
  const blended = prototype.map((row, x) => row.map((value, f) => (1 - weight) * value + weight * observation[x][f]));
  let norm = 1e-9; blended.forEach((row) => row.forEach((value) => { norm += value * value; })); norm = Math.sqrt(norm);
  blended.forEach((row) => row.forEach((value, f) => { row[f] = value / norm; }));
  return blended;
}

function periodHypotheses(times: number[], range: [number, number]) {
  if (times.length < 3) return [] as PeriodHypothesis[];
  const scored: PeriodHypothesis[] = [];
  for (let rate = range[0]; rate <= range[1]; rate += 0.5) {
    const period = 60 / rate, residuals: number[] = [], phases = times.map((time) => ((time % period) + period) % period);
    for (let first = 0; first < times.length; first += 1) for (let second = first + 1; second < times.length; second += 1) {
      const interval = times[second] - times[first], multiple = Math.max(1, Math.round(interval / period));
      if (multiple <= 8) residuals.push(Math.abs(interval - multiple * period));
    }
    const sigma = Math.max(0.018, period * 0.06), pairScore = residuals.reduce((sum, residual) => sum + Math.exp(-0.5 * (residual / sigma) ** 2), 0) / Math.max(1, residuals.length);
    let cosine = 0, sine = 0; phases.forEach((phase) => { const angle = 2 * Math.PI * phase / period; cosine += Math.cos(angle); sine += Math.sin(angle); });
    const concentration = Math.hypot(cosine, sine) / times.length, phase = ((Math.atan2(sine, cosine) / (2 * Math.PI)) * period + period) % period;
    scored.push({ periodSeconds: period, rateCyclesPerMinute: rate, phaseSeconds: phase, score: 0.6 * pairScore + 0.4 * concentration, uncertaintySeconds: Math.sqrt(residuals.reduce((sum, residual) => sum + residual ** 2, 0) / Math.max(1, residuals.length)) });
  }
  scored.sort((a, b) => b.score - a.score);
  const selected: PeriodHypothesis[] = [];
  for (const candidate of scored) {
    if (selected.some((other) => Math.abs(other.rateCyclesPerMinute - candidate.rateCyclesPerMinute) < 3)) continue;
    selected.push(candidate); if (selected.length === 3) break;
  }
  return selected;
}

function proposeAndTrack(significance: number[][], decomposition: ReturnType<typeof nmf>, frameSeconds: number, analysisRange: [number, number], duration: number, rateRange: [number, number], detectionSigma: number) {
  const drafts: Omit<EventProposal, "trackId" | "associationSimilarity" | "timingInnovationSeconds">[] = [];
  const { w, h, rank, timeBins, frequencyBins, stride } = decomposition;
  for (let component = 0; component < rank; component += 1) {
    const activation = Array.from({ length: timeBins }, (_, t) => h[component * timeBins + t]);
    const smoothed = activation.map((value, t) => (activation[t - 1] ?? value) * 0.2 + value * 0.6 + (activation[t + 1] ?? value) * 0.2);
    const center = median(smoothed), mad = Math.max(1e-8, median(smoothed.map((value) => Math.abs(value - center))));
    const threshold = Math.max(quantile(smoothed, 0.78), center + detectionSigma * mad);
    const spectral = Array.from({ length: frequencyBins }, (_, f) => w[f * rank + component]), spectralMax = Math.max(1e-9, ...spectral);
    const support = spectral.map((value, f) => ({ value, f })).filter(({ value }) => value > spectralMax * 0.16).map(({ f }) => f);
    const lowIndex = support.length ? Math.min(...support) : 0, highIndex = support.length ? Math.max(...support) : frequencyBins - 1;
    const lowHz = Math.max(analysisRange[0], FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, lowIndex / Math.max(1, frequencyBins - 1)));
    const highHz = Math.min(analysisRange[1], FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, highIndex / Math.max(1, frequencyBins - 1)));
    let lastAccepted = -100;
    for (let t = 1; t < timeBins - 1; t += 1) if (smoothed[t] >= threshold && smoothed[t] >= smoothed[t - 1] && smoothed[t] > smoothed[t + 1]) {
      if (t - lastAccepted < Math.max(1, Math.round(0.1 / (frameSeconds * stride)))) {
        if (smoothed[t] <= smoothed[lastAccepted]) continue;
        const previousIndex = drafts.findIndex((draft) => draft.component === component && Math.abs(draft.timeSeconds - lastAccepted * stride * frameSeconds) < frameSeconds * stride * 1.5);
        if (previousIndex >= 0) drafts.splice(previousIndex, 1);
      }
      lastAccepted = t;
      const centerFrame = Math.min(significance.length - 1, Math.round(t * stride + stride / 2)), descriptor = descriptorAt(significance, centerFrame);
      let weightedFrequency = 0, spectralWeight = 1e-9;
      for (let f = 0; f < frequencyBins; f += 1) { const hz = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, f / Math.max(1, frequencyBins - 1)); weightedFrequency += hz * spectral[f]; spectralWeight += spectral[f]; }
      drafts.push({ id: `E${drafts.length + 1}`, component, timeSeconds: centerFrame * frameSeconds, startSeconds: Math.max(0, (centerFrame - 6) * frameSeconds), endSeconds: Math.min(duration, (centerFrame + 7) * frameSeconds), lowHz, highHz: Math.max(lowHz + 20, highHz), amplitude: smoothed[t], spectralCentroidHz: weightedFrequency / spectralWeight, descriptor });
      if (drafts.length >= 80) break;
    }
  }
  drafts.sort((a, b) => a.timeSeconds - b.timeSeconds || b.amplitude - a.amplitude);
  const deduplicated: typeof drafts = [];
  for (const draft of drafts) {
    const duplicate = deduplicated.findIndex((other) => Math.abs(other.timeSeconds - draft.timeSeconds) < 0.045 && descriptorSimilarity(other.descriptor, draft.descriptor) > 0.92);
    if (duplicate < 0) deduplicated.push(draft); else if (draft.amplitude > deduplicated[duplicate].amplitude) deduplicated[duplicate] = draft;
  }
  deduplicated.forEach((event, index) => { event.id = `E${String(index + 1).padStart(2, "0")}`; });

  type MutableTrack = { id: string; color: string; events: EventProposal[]; prototype: number[][]; coherence: number[] };
  const tracks: MutableTrack[] = [], events: EventProposal[] = [];
  for (const draft of deduplicated) {
    let bestTrack: MutableTrack | null = null, bestScore = -1, bestSimilarity = 0, bestInnovation: number | null = null;
    const ordered = [...tracks].sort((a, b) => {
      const aTimes = a.events.map((event) => event.timeSeconds), bTimes = b.events.map((event) => event.timeSeconds);
      const aHypothesis = periodHypotheses(aTimes, rateRange)[0], bHypothesis = periodHypotheses(bTimes, rateRange)[0];
      return (aHypothesis?.uncertaintySeconds ?? 99) - (bHypothesis?.uncertaintySeconds ?? 99);
    });
    for (const track of ordered) {
      const similarity = descriptorSimilarity(track.prototype, draft.descriptor);
      const times = track.events.map((event) => event.timeSeconds), hypothesis = periodHypotheses(times, rateRange)[0];
      let timingScore = 0.5, innovation: number | null = null;
      if (hypothesis) {
        const elapsed = draft.timeSeconds - track.events[track.events.length - 1].timeSeconds, multiple = Math.max(1, Math.round(elapsed / hypothesis.periodSeconds));
        innovation = Math.abs(elapsed - multiple * hypothesis.periodSeconds);
        const gate = Math.max(0.05, 3 * hypothesis.uncertaintySeconds + 0.02 * multiple);
        timingScore = Math.exp(-0.5 * (innovation / gate) ** 2);
      }
      const recent = draft.timeSeconds - track.events[track.events.length - 1].timeSeconds < 3.5;
      const accepted = (recent && similarity > 0.64 && timingScore > 0.08) || similarity > 0.79;
      const score = 0.78 * similarity + 0.22 * timingScore;
      if (accepted && score > bestScore) { bestTrack = track; bestScore = score; bestSimilarity = similarity; bestInnovation = innovation; }
    }
    if (!bestTrack) {
      bestTrack = { id: `T${String(tracks.length + 1).padStart(2, "0")}`, color: TRACK_COLORS[tracks.length % TRACK_COLORS.length], events: [], prototype: draft.descriptor, coherence: [] };
      tracks.push(bestTrack); bestSimilarity = 1; bestScore = 1;
    }
    const event: EventProposal = { ...draft, trackId: bestTrack.id, associationSimilarity: bestSimilarity, timingInnovationSeconds: bestInnovation };
    if (bestTrack.events.length) bestTrack.coherence.push(bestSimilarity);
    bestTrack.events.push(event); bestTrack.prototype = blendPrototype(bestTrack.prototype, draft.descriptor, bestTrack.events.length); events.push(event);
  }
  const finalized: StructureTrack[] = tracks.map((track) => {
    const hypotheses = periodHypotheses(track.events.map((event) => event.timeSeconds), rateRange), best = hypotheses[0];
    const lastSeen = track.events[track.events.length - 1]?.timeSeconds ?? 0, dormantAfter = best ? Math.max(3, 2.5 * best.periodSeconds) : 5;
    const state = duration - lastSeen > dormantAfter ? "dormant" : track.events.length >= 3 && (track.coherence.length ? track.coherence.reduce((sum, value) => sum + value, 0) / track.coherence.length : 1) > 0.68 ? "confirmed" : "candidate";
    return { id: track.id, color: track.color, state, eventIds: track.events.map((event) => event.id), prototype: track.prototype, templateCoherence: track.coherence.length ? track.coherence.reduce((sum, value) => sum + value, 0) / track.coherence.length : 1, meanAmplitude: track.events.reduce((sum, event) => sum + event.amplitude, 0) / track.events.length, lastSeenSeconds: lastSeen, periodHypotheses: hypotheses };
  }).sort((a, b) => b.eventIds.length - a.eventIds.length);
  return { events, tracks: finalized };
}

export function analyze(pcm: Float32Array, sampleRate: number, config: AppliedConfig): Analysis {
  const started = performance.now(), n = FFT_SIZE, hop = HOP_SIZE, frameRate = sampleRate / hop, binHz = sampleRate / n;
  const maxBin = Math.min(n / 2, Math.ceil(FREQ_MAX / binHz)), magnitudes: number[][] = [];
  for (let offset = 0; offset + n < pcm.length; offset += hop) magnitudes.push(spectrum(pcm, offset, n, maxBin));
  const processed = processSpectrum(magnitudes, hop / sampleRate, sampleRate, n, config.preprocessing, config.background, config.noiseProfile), flux = processed.output;

  const global = new Array(flux.length).fill(0);
  const [supportLow, supportHigh] = bandpassSupport(config.preprocessing);
  const analysisLowBin = Math.max(1, Math.floor(supportLow / binHz));
  const analysisHighBin = Math.min(maxBin - 1, Math.ceil(supportHigh / binHz));
  for (let bin = analysisLowBin; bin <= analysisHighBin; bin += 1) {
    const column = flux.map((row) => row[bin]), center = median(column);
    const mad = Math.max(1e-6, median(column.map((value) => Math.abs(value - center))));
    for (let t = 0; t < flux.length; t += 1) global[t] += Math.min(12, Math.max(0, (flux[t][bin] - center) / mad));
  }
  const globalScale = Math.sqrt(Math.max(1, analysisHighBin - analysisLowBin + 1));
  for (let t = 0; t < global.length; t += 1) global[t] /= globalScale;
  const bandEnvelopes = config.bands.map((band) => flux.map((row) => {
    const low = Math.max(1, Math.floor(band.low / binHz)), high = Math.min(maxBin - 1, Math.ceil(band.high / binHz));
    let sum = 0; for (let bin = low; bin <= high; bin += 1) sum += row[bin];
    return sum / Math.sqrt(Math.max(1, high - low + 1));
  }));
  const robustBands = bandEnvelopes.map((envelope) => {
    const center = median(envelope), mad = Math.max(1e-6, median(envelope.map((value) => Math.abs(value - center))));
    return envelope.map((value) => Math.max(0, (value - center) / mad));
  });
  const smooth = (envelope: number[]) => envelope.map((value, i) => (envelope[i - 1] ?? value) * 0.25 + value * 0.5 + (envelope[i + 1] ?? value) * 0.25);
  const novelty = [smooth(global), ...robustBands.map(smooth)];
  const peaks = novelty.map((envelope) => {
    const center = median(envelope), mad = Math.max(1e-6, median(envelope.map((value) => Math.abs(value - center))));
    const threshold = center + 2.5 * mad, accepted: number[] = [];
    for (let i = 2; i < envelope.length - 2; i += 1) if (envelope[i] > threshold && envelope[i] >= envelope[i - 1] && envelope[i] > envelope[i + 1]) {
      if (!accepted.length || i - accepted[accepted.length - 1] > frameRate * 0.11) accepted.push(i);
      else if (envelope[i] > envelope[accepted[accepted.length - 1]]) accepted[accepted.length - 1] = i;
    }
    return accepted;
  });
  const acf = (envelope: number[], rate: number) => {
    const lag = Math.max(1, Math.round((60 / rate) * frameRate)), count = envelope.length - lag;
    if (count < 3) return 0;
    let firstMean = 0, secondMean = 0;
    for (let i = lag; i < envelope.length; i += 1) { firstMean += envelope[i]; secondMean += envelope[i - lag]; }
    firstMean /= count; secondMean /= count;
    let numerator = 0, firstEnergy = 0, secondEnergy = 0;
    for (let i = lag; i < envelope.length; i += 1) { const first = envelope[i] - firstMean, second = envelope[i - lag] - secondMean; numerator += first * second; firstEnergy += first ** 2; secondEnergy += second ** 2; }
    return numerator / Math.max(1e-9, Math.sqrt(firstEnergy * secondEnergy));
  };
  const ioi = (events: number[], rate: number) => {
    const period = 60 / rate, sigma = Math.max(0.018, period * 0.055); let score = 0, weight = 0;
    for (let first = 0; first < events.length; first += 1) for (let second = first + 1; second < events.length && second < first + 7; second += 1) {
      const difference = (events[second] - events[first]) / frameRate, multiple = Math.max(1, Math.round(difference / period)); if (multiple > 8) continue;
      score += Math.exp(-0.5 * ((difference - multiple * period) / sigma) ** 2) / Math.sqrt(multiple); weight += 1 / Math.sqrt(multiple);
    }
    return score / Math.max(1, weight);
  };
  const fold = (envelope: number[], rate: number) => {
    const period = 60 / rate, profile = new Array(32).fill(0), weights = new Array(32).fill(0);
    envelope.forEach((value, i) => { const phase = (((i / frameRate) % period) / period) * 32, index = Math.floor(phase) % 32; profile[index] += value; weights[index] += 1; });
    for (let i = 0; i < 32; i += 1) profile[i] /= Math.max(1, weights[i]);
    const mean = profile.reduce((sum, value) => sum + value, 0) / 32, deviation = Math.sqrt(profile.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 32), maximum = Math.max(...profile);
    return { score: (maximum - mean) / Math.max(1e-6, deviation) / 6, phase: (profile.indexOf(maximum) / 32) * period, profile };
  };
  const raw: Array<MethodPoint & { profile: number[] }> = [];
  for (let rate = config.rateRange[0]; rate <= config.rateRange[1]; rate += 0.5) { const folded = fold(novelty[0], rate); raw.push({ rate, acf: acf(novelty[0], rate), ioi: ioi(peaks[0], rate), fold: folded.score, fused: 0, phase: folded.phase, profile: folded.profile }); }
  const normalizedAcf = normalize(raw.map((point) => point.acf)), normalizedIoi = normalize(raw.map((point) => point.ioi)), normalizedFold = normalize(raw.map((point) => point.fold));
  const methods: MethodPoint[] = raw.map((point, i) => ({ ...point, fused: 0.38 * normalizedAcf[i] + 0.25 * normalizedIoi[i] + 0.37 * normalizedFold[i] }));
  methods.sort((a, b) => b.fused - a.fused); const candidates: Candidate[] = [];
  for (const candidate of methods) {
    if (candidates.some((other) => Math.abs(other.rate - candidate.rate) < 3.5)) continue;
    const root = candidates[0]?.rate ?? candidate.rate, ratio = candidate.rate / root;
    const relation = Math.abs(ratio - 2) < 0.12 ? "double" : Math.abs(ratio - 0.5) < 0.08 ? "half" : candidates.length ? "alternate" : "primary";
    candidates.push({ ...candidate, period: 60 / candidate.rate, cycles: pcm.length / sampleRate / (60 / candidate.rate), relation });
  }
  const best = candidates[0] ?? { rate: 0, phase: 0, fused: 0, period: 0, cycles: 0, relation: "none", acf: 0, ioi: 0, fold: 0 };
  const phaseRates: number[] = [], phaseMap: number[][] = [];
  for (let rate = config.rateRange[0]; rate <= config.rateRange[1]; rate += 3) { phaseRates.push(rate); phaseMap.push(fold(novelty[0], rate).profile); }
  const toWaterfall = (frames: ArrayLike<number>[]) => frames.map((frame) => Array.from({ length: DISPLAY_BINS }, (_, y) => { const hz = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, y / (DISPLAY_BINS - 1)), bin = Math.min(maxBin - 1, Math.round(hz / binHz)); return frame[bin]; }));
  const waterfall = toWaterfall(magnitudes), foregroundWaterfall = toWaterfall(flux), significanceWaterfall = buildSignificance(foregroundWaterfall);
  const decomposition = nmf(significanceWaterfall, config.decompositionRank), tracked = proposeAndTrack(significanceWaterfall, decomposition, hop / sampleRate, [supportLow, supportHigh], pcm.length / sampleRate, config.rateRange, config.detectionSigma);
  let square = 0, peak = 0; for (const value of pcm) { square += value * value; peak = Math.max(peak, Math.abs(value)); }
  const duration = pcm.length / sampleRate, status = best.cycles >= 5 && peaks[0].length >= 4 && best.fused > 0.48 ? "sufficient" : "insufficient";
  return { configUsed: JSON.parse(JSON.stringify(config)) as AppliedConfig, duration, sampleRate, fftSize: n, hopSize: hop, computeMs: performance.now() - started, status, waterfall, foregroundWaterfall, significanceWaterfall, novelty, peaks, methods: methods.sort((a, b) => a.rate - b.rate), candidates: candidates.slice(0, 6), phaseMap, phaseRates, bestRate: best.rate, bestPhase: best.phase, noiseFloor: median(Array.from(pcm, (value) => Math.abs(value))), peak, rms: Math.sqrt(square / Math.max(1, pcm.length)), retainedFraction: processed.retainedFraction, bandpassRetainedFraction: processed.bandpassRetainedFraction, events: tracked.events, tracks: tracked.tracks, decomposition: { rank: decomposition.rank, iterations: decomposition.iterations, normalizedError: decomposition.error, temporalStride: decomposition.stride } };
}
