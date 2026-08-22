"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { quantile, type Analysis } from "./pulseprint-dsp";

export type FoldSelection = { rate: number; phase: number; source: "candidate" | "evidence" | "surface" | "track" };

export function periodTicks(duration: number, selection: FoldSelection | null) {
  if (!selection || selection.rate <= 0) return [];
  const period = 60 / selection.rate, ticks: number[] = [];
  let time = ((selection.phase % period) + period) % period;
  while (time - period >= 0) time -= period;
  for (; time <= duration + 1e-6; time += period) if (time >= 0) ticks.push(time);
  return ticks;
}

function Canvas({ draw, className }: { draw: (context: CanvasRenderingContext2D, width: number, height: number) => void; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const density = Math.min(2, devicePixelRatio || 1), width = Math.max(1, Math.floor(canvas.clientWidth * density)), height = Math.max(1, Math.floor(canvas.clientHeight * density));
    canvas.width = width; canvas.height = height; draw(canvas.getContext("2d")!, width, height);
  }, [draw]);
  return <canvas ref={ref} className={className} />;
}

export function PeriodGridOverlay({ duration, selection }: { duration: number; selection: FoldSelection | null }) {
  const ticks = useMemo(() => periodTicks(duration, selection), [duration, selection]);
  return <div className="period-grid-overlay" aria-hidden="true">{ticks.map((time, index) => <span key={`${time}-${index}`} style={{ left: `${100 * time / duration}%` }}><i>{index + 1}</i></span>)}</div>;
}

export function CycleStack({ result, selection }: { result: Analysis; selection: FoldSelection }) {
  const draw = useCallback((context: CanvasRenderingContext2D, width: number, height: number) => {
    context.fillStyle = "#05060a"; context.fillRect(0, 0, width, height);
    const period = 60 / selection.rate, frameSeconds = result.hopSize / result.sampleRate, ticks = periodTicks(result.duration, selection), phaseBins = 64;
    const rows = ticks.filter((time) => time + period <= result.duration + frameSeconds);
    const global = result.novelty[0], samples: number[][] = rows.map((start) => Array.from({ length: phaseBins }, (_, bin) => {
      const time = start + (bin / phaseBins) * period, index = Math.max(0, Math.min(global.length - 1, Math.round(time / frameSeconds)));
      return global[index] ?? 0;
    }));
    const maximum = Math.max(1e-9, quantile(samples.flat(), 0.985));
    samples.forEach((row, y) => row.forEach((value, x) => {
      const visible = Math.min(1, value / maximum);
      context.fillStyle = `hsl(${265 - visible * 205} 92% ${3 + visible * 68}%)`;
      context.fillRect((x / phaseBins) * width, (y / Math.max(1, samples.length)) * height, Math.ceil(width / phaseBins) + 1, Math.ceil(height / Math.max(1, samples.length)) + 1);
    }));
    context.strokeStyle = "#c9ff72"; context.lineWidth = Math.max(1, width / 500); context.beginPath();
    for (let x = 0; x < phaseBins; x += 1) {
      const mean = samples.reduce((sum, row) => sum + row[x], 0) / Math.max(1, samples.length), px = (x / (phaseBins - 1)) * width, py = height - Math.min(1, mean / maximum) * height * 0.3 - 2;
      if (x) context.lineTo(px, py); else context.moveTo(px, py);
    }
    context.stroke();
  }, [result, selection]);
  return <Canvas className="fold-canvas cycle-stack" draw={draw} />;
}

export function MeanFoldSpectrogram({ result, selection }: { result: Analysis; selection: FoldSelection }) {
  const draw = useCallback((context: CanvasRenderingContext2D, width: number, height: number) => {
    context.fillStyle = "#05060a"; context.fillRect(0, 0, width, height);
    const period = 60 / selection.rate, frameSeconds = result.hopSize / result.sampleRate, ticks = periodTicks(result.duration, selection), phaseBins = 64, frequencyBins = result.significanceWaterfall[0]?.length ?? 0;
    const folded = Array.from({ length: phaseBins }, () => new Array(frequencyBins).fill(0)), weights = new Array(phaseBins).fill(0);
    for (const start of ticks) for (let phase = 0; phase < phaseBins; phase += 1) {
      const time = start + (phase / phaseBins) * period; if (time >= result.duration) continue;
      const index = Math.max(0, Math.min(result.significanceWaterfall.length - 1, Math.round(time / frameSeconds))), frame = result.significanceWaterfall[index];
      for (let frequency = 0; frequency < frequencyBins; frequency += 1) folded[phase][frequency] += frame[frequency] ?? 0;
      weights[phase] += 1;
    }
    folded.forEach((column, phase) => column.forEach((value, frequency) => { column[frequency] = value / Math.max(1, weights[phase]); }));
    const maximum = Math.max(1e-9, quantile(folded.flat(), 0.995));
    folded.forEach((column, x) => column.forEach((value, y) => {
      const visible = Math.min(1, value / maximum);
      context.fillStyle = `hsl(${285 - visible * 220} 92% ${3 + visible * 68}%)`;
      context.fillRect((x / phaseBins) * width, height - ((y + 1) / frequencyBins) * height, Math.ceil(width / phaseBins) + 1, Math.ceil(height / frequencyBins) + 1);
    }));
    context.strokeStyle = "#c9ff72"; context.lineWidth = 1; context.beginPath(); context.moveTo(0, 0); context.lineTo(0, height); context.stroke();
  }, [result, selection]);
  return <Canvas className="fold-canvas mean-fold" draw={draw} />;
}
