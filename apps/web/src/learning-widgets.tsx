import { useState } from 'react';
import type { WidgetConfig } from './learning-timeline';

export type BinarySearchStep = { low: number; high: number; middle: number; value: number; outcome: 'found' | 'lower' | 'higher' };

export function binarySearchTrace(items: number[], target: number): BinarySearchStep[] {
  const trace: BinarySearchStep[] = [];
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = items[middle];
    const outcome = value === target ? 'found' : value < target ? 'higher' : 'lower';
    trace.push({ low, high, middle, value, outcome });
    if (outcome === 'found') break;
    if (outcome === 'higher') low = middle + 1;
    else high = middle - 1;
  }
  return trace;
}

export function vectorMetrics(x: number, y: number): { magnitude: number; angle: number } {
  return { magnitude: Math.hypot(x, y), angle: Math.atan2(y, x) * 180 / Math.PI };
}

type WidgetProps = { config: WidgetConfig };

export function VectorExplorer({ config }: WidgetProps) {
  const initialX = Number(config.vector_x ?? 3);
  const initialY = Number(config.vector_y ?? 4);
  const limit = Number(config.axis_limit ?? 10);
  const [x, setX] = useState(initialX);
  const [y, setY] = useState(initialY);
  const metrics = vectorMetrics(x, y);
  const scale = 120 / limit;
  const endX = 150 + x * scale;
  const endY = 150 - y * scale;
  const marker = 'vector-arrow-head';
  return <section className="mt-8" aria-labelledby="vector-explorer-heading">
    <h3 id="vector-explorer-heading" className="text-lg font-medium">{config.prompt || 'Explore a vector'}</h3>
    <p className="mt-2 text-sm text-[#b7adcc]">Adjust the horizontal and vertical components to see how direction and magnitude change.</p>
    <svg viewBox="0 0 300 300" role="img" aria-label={`Vector ${x.toFixed(1)} horizontal and ${y.toFixed(1)} vertical; magnitude ${metrics.magnitude.toFixed(2)}, angle ${metrics.angle.toFixed(1)} degrees`} className="mt-4 h-64 w-full rounded-xl bg-[#0e0621]">
      <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#e57fab" /></marker></defs>
      <path d="M30 150H270 M150 270V30" stroke="#81779a" strokeWidth="1" />
      <path d={`M150 150 L${endX} ${endY}`} stroke="#e57fab" strokeWidth="4" markerEnd={`url(#${marker})`} />
      <circle cx={endX} cy={endY} r="5" fill="#efc778" />
      <text x="258" y="142" fill="#b7adcc" fontSize="12">x</text><text x="158" y="42" fill="#b7adcc" fontSize="12">y</text>
    </svg>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Horizontal component · {x.toFixed(1)}<input aria-label="Horizontal vector component" type="range" min={-limit} max={limit} step="0.5" value={x} onChange={event => setX(Number(event.target.value))} className="accent-[#e57fab]" /></label>
      <label className="grid gap-1 text-sm">Vertical component · {y.toFixed(1)}<input aria-label="Vertical vector component" type="range" min={-limit} max={limit} step="0.5" value={y} onChange={event => setY(Number(event.target.value))} className="accent-[#e57fab]" /></label>
    </div>
    <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-[#0e0621] p-3 text-sm">Magnitude {metrics.magnitude.toFixed(2)} · Direction {metrics.angle.toFixed(1)}°</p>
    <button type="button" onClick={() => { setX(initialX); setY(initialY); }} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-sm">Reset vector</button>
  </section>;
}

export function LogicGateExplorer({ config }: WidgetProps) {
  const gate = String(config.gate || 'AND').toUpperCase();
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const output = gate === 'NOT' ? !a : gate === 'OR' ? a || b : gate === 'XOR' ? a !== b : gate === 'XNOR' ? a === b : a && b;
  return <section className="mt-8" aria-labelledby="logic-gate-heading">
    <h3 id="logic-gate-heading" className="text-lg font-medium">{config.prompt || `Explore the ${gate} gate`}</h3>
    <p className="mt-2 text-sm text-[#b7adcc]">Toggle inputs and follow the truth rule to predict the output.</p>
    <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl bg-[#0e0621] p-5">
      <label className="flex items-center gap-2">Input A <input type="checkbox" checked={a} onChange={event => setA(event.target.checked)} /></label>
      {gate !== 'NOT' && <label className="flex items-center gap-2">Input B <input type="checkbox" checked={b} onChange={event => setB(event.target.checked)} /></label>}
      <span aria-hidden="true" className="rounded-lg bg-[#6350c8] px-4 py-3 font-mono">{gate}</span>
      <p role="status" aria-live="polite" className="font-mono">Output: {Number(output)}</p>
    </div>
    <p className="mt-3 text-xs text-[#b7adcc]">{gate === 'AND' ? 'AND is true only when both inputs are true.' : gate === 'OR' ? 'OR is true when at least one input is true.' : gate === 'XOR' ? 'XOR is true when the inputs differ.' : gate === 'NOT' ? 'NOT flips its single input.' : gate === 'XNOR' ? 'XNOR is true when the inputs match.' : 'This gate is true when both inputs match.'}</p>
    <button type="button" onClick={() => { setA(false); setB(false); }} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-sm">Reset inputs</button>
  </section>;
}

export function BinarySearchVisualizer({ config }: WidgetProps) {
  const items = Array.isArray(config.items) && config.items.length ? config.items : [2, 5, 8, 12, 17, 23, 31];
  const target = Number(config.target ?? 17);
  const trace = binarySearchTrace(items, target);
  const [stepIndex, setStepIndex] = useState(-1);
  const step = trace[stepIndex];
  return <section className="mt-8" aria-labelledby="binary-search-heading">
    <h3 id="binary-search-heading" className="text-lg font-medium">{config.prompt || 'Search a sorted list'}</h3>
    <p className="mt-2 text-sm text-[#b7adcc]">Binary search checks the middle value, then discards the half that cannot contain the target.</p>
    <ol aria-label="Sorted values" className="mt-5 flex flex-wrap gap-2">{items.map((item, index) => <li key={`${index}-${item}`} aria-current={step?.middle === index ? 'step' : undefined} className={`min-w-10 rounded-lg border px-3 py-2 text-center font-mono ${step?.middle === index ? 'border-[#efc778] bg-[#6350c8]' : step && (index < step.low || index > step.high) ? 'border-white/5 opacity-40' : 'border-white/10 bg-[#0e0621]'}`}>{item}</li>)}</ol>
    <p role="status" aria-live="polite" className="mt-4 min-h-6 text-sm">{step ? `Check ${step.value} at index ${step.middle}: ${step.outcome === 'found' ? 'target found.' : step.outcome === 'higher' ? 'target is higher; move right.' : 'target is lower; move left.'}` : 'Ready to search.'}</p>
    <div className="mt-3 flex gap-2"><button type="button" disabled={stepIndex >= trace.length - 1} onClick={() => setStepIndex(index => Math.min(index + 1, trace.length - 1))} className="rounded-lg bg-[#6350c8] px-3 py-2 text-sm">{stepIndex < 0 ? 'Start search' : 'Next step'}</button><button type="button" onClick={() => setStepIndex(-1)} className="rounded-lg border border-white/15 px-3 py-2 text-sm">Reset search</button></div>
  </section>;
}
