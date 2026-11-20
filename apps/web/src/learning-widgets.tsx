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

export function probabilityOutcomes(experiment: 'coin_flip' | 'die_roll', seed: number, trials: number): number[] {
  let state = seed >>> 0;
  return Array.from({ length: trials }, () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return experiment === 'coin_flip' ? state % 2 : state % 6 + 1;
  });
}

export type MachineTransition = { from: string; input: string; to: string };

export function transitionState(current: string, input: string, transitions: MachineTransition[]): string {
  return transitions.find(transition => transition.from === current && transition.input === input)?.to ?? current;
}

export function classificationScore(answers: Record<string, string>, items: Array<{ label: string; category: string }>): number {
  if (items.length === 0) return 0;
  return items.filter(item => answers[item.label] === item.category).length / items.length;
}

export type WidgetInteractionState = {
  vectorX?: number; vectorY?: number; inputA?: boolean; inputB?: boolean;
  searchStep?: number; sampleSize?: number; machineState?: string;
  classifications?: Record<string, string>;
};
type WidgetProps = { config: WidgetConfig; state?: WidgetInteractionState; onStateChange?: (state: WidgetInteractionState) => void };
const save = (current: WidgetInteractionState | undefined, change: WidgetInteractionState, onChange?: (state: WidgetInteractionState) => void) => onChange?.({ ...current, ...change });

export function VectorExplorer({ config, state, onStateChange }: WidgetProps) {
  const initialX = Number(config.vector_x ?? 3);
  const initialY = Number(config.vector_y ?? 4);
  const limit = Number(config.axis_limit ?? 10);
  const [x, setX] = useState(state?.vectorX ?? initialX);
  const [y, setY] = useState(state?.vectorY ?? initialY);
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
      <label className="grid gap-1 text-sm">Horizontal component · {x.toFixed(1)}<input aria-label="Horizontal vector component" type="range" min={-limit} max={limit} step="0.5" value={x} onChange={event => { const next=Number(event.target.value);setX(next);save(state,{vectorX:next},onStateChange); }} className="accent-[#e57fab]" /></label>
      <label className="grid gap-1 text-sm">Vertical component · {y.toFixed(1)}<input aria-label="Vertical vector component" type="range" min={-limit} max={limit} step="0.5" value={y} onChange={event => { const next=Number(event.target.value);setY(next);save(state,{vectorY:next},onStateChange); }} className="accent-[#e57fab]" /></label>
    </div>
    <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-[#0e0621] p-3 text-sm">Magnitude {metrics.magnitude.toFixed(2)} · Direction {metrics.angle.toFixed(1)}°</p>
    <button type="button" onClick={() => { setX(initialX); setY(initialY); onStateChange?.({vectorX:initialX,vectorY:initialY}); }} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-sm">Reset vector</button>
  </section>;
}

export function LogicGateExplorer({ config, state, onStateChange }: WidgetProps) {
  const gate = String(config.gate || 'AND').toUpperCase();
  const [a, setA] = useState(state?.inputA ?? false);
  const [b, setB] = useState(state?.inputB ?? false);
  const output = gate === 'NOT' ? !a : gate === 'OR' ? a || b : gate === 'XOR' ? a !== b : gate === 'XNOR' ? a === b : a && b;
  return <section className="mt-8" aria-labelledby="logic-gate-heading">
    <h3 id="logic-gate-heading" className="text-lg font-medium">{config.prompt || `Explore the ${gate} gate`}</h3>
    <p className="mt-2 text-sm text-[#b7adcc]">Toggle inputs and follow the truth rule to predict the output.</p>
    <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl bg-[#0e0621] p-5">
      <label className="flex items-center gap-2">Input A <input type="checkbox" checked={a} onChange={event => { const next=event.target.checked;setA(next);save(state,{inputA:next},onStateChange); }} /></label>
      {gate !== 'NOT' && <label className="flex items-center gap-2">Input B <input type="checkbox" checked={b} onChange={event => { const next=event.target.checked;setB(next);save(state,{inputB:next},onStateChange); }} /></label>}
      <span aria-hidden="true" className="rounded-lg bg-[#6350c8] px-4 py-3 font-mono">{gate}</span>
      <p role="status" aria-live="polite" className="font-mono">Output: {Number(output)}</p>
    </div>
    <p className="mt-3 text-xs text-[#b7adcc]">{gate === 'AND' ? 'AND is true only when both inputs are true.' : gate === 'OR' ? 'OR is true when at least one input is true.' : gate === 'XOR' ? 'XOR is true when the inputs differ.' : gate === 'NOT' ? 'NOT flips its single input.' : gate === 'XNOR' ? 'XNOR is true when the inputs match.' : 'This gate is true when both inputs match.'}</p>
    <button type="button" onClick={() => { setA(false); setB(false); onStateChange?.({inputA:false,inputB:false}); }} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-sm">Reset inputs</button>
  </section>;
}

export function BinarySearchVisualizer({ config, state, onStateChange }: WidgetProps) {
  const items = Array.isArray(config.items) && config.items.length ? config.items : [2, 5, 8, 12, 17, 23, 31];
  const target = Number(config.target ?? 17);
  const trace = binarySearchTrace(items, target);
  const [stepIndex, setStepIndex] = useState(state?.searchStep ?? -1);
  const step = trace[stepIndex];
  return <section className="mt-8" aria-labelledby="binary-search-heading">
    <h3 id="binary-search-heading" className="text-lg font-medium">{config.prompt || 'Search a sorted list'}</h3>
    <p className="mt-2 text-sm text-[#b7adcc]">Binary search checks the middle value, then discards the half that cannot contain the target.</p>
    <ol aria-label="Sorted values" className="mt-5 flex flex-wrap gap-2">{items.map((item, index) => <li key={`${index}-${item}`} aria-current={step?.middle === index ? 'step' : undefined} className={`min-w-10 rounded-lg border px-3 py-2 text-center font-mono ${step?.middle === index ? 'border-[#efc778] bg-[#6350c8]' : step && (index < step.low || index > step.high) ? 'border-white/5 opacity-40' : 'border-white/10 bg-[#0e0621]'}`}>{item}</li>)}</ol>
    <p role="status" aria-live="polite" className="mt-4 min-h-6 text-sm">{step ? `Check ${step.value} at index ${step.middle}: ${step.outcome === 'found' ? 'target found.' : step.outcome === 'higher' ? 'target is higher; move right.' : 'target is lower; move left.'}` : 'Ready to search.'}</p>
    <div className="mt-3 flex gap-2"><button type="button" disabled={stepIndex >= trace.length - 1} onClick={() => setStepIndex(index => { const next=Math.min(index+1,trace.length-1);save(state,{searchStep:next},onStateChange);return next; })} className="rounded-lg bg-[#6350c8] px-3 py-2 text-sm">{stepIndex < 0 ? 'Start search' : 'Next step'}</button><button type="button" onClick={() => {setStepIndex(-1);onStateChange?.({searchStep:-1});}} className="rounded-lg border border-white/15 px-3 py-2 text-sm">Reset search</button></div>
  </section>;
}

export function ProbabilitySimulation({ config, state, onStateChange }: WidgetProps) {
  const experiment = config.experiment === 'die_roll' ? 'die_roll' : 'coin_flip';
  const maxTrials = Number(config.trials ?? 100);
  const seed = Number(config.seed ?? 1);
  const [sampleSize, setSampleSize] = useState(state?.sampleSize ?? 1);
  const outcomes = probabilityOutcomes(experiment, seed, sampleSize);
  const categories = experiment === 'coin_flip' ? [{ value: 0, label: 'Heads' }, { value: 1, label: 'Tails' }] : Array.from({ length: 6 }, (_, index) => ({ value: index + 1, label: `Roll ${index + 1}` }));
  const counts = categories.map(category => ({ ...category, count: outcomes.filter(outcome => outcome === category.value).length }));
  const heads = counts.find(category => category.value === 0);
  return <section className="mt-8" aria-labelledby="probability-simulation-heading">
    <h3 id="probability-simulation-heading" className="text-lg font-medium">{config.prompt || (experiment === 'coin_flip' ? 'Explore coin-flip probability' : 'Explore die-roll probability')}</h3>
    <p className="mt-2 text-sm text-[#b7adcc]">This repeatable simulation uses the configured seed, so reset produces the same outcome sequence.</p>
    <label className="mt-5 grid gap-1 text-sm">Number of trials · {sampleSize}<input aria-label="Number of simulation trials" type="range" min="1" max={maxTrials} value={sampleSize} onChange={event => {const next=Number(event.target.value);setSampleSize(next);save(state,{sampleSize:next},onStateChange);}} className="accent-[#e57fab]" /></label>
    <ul aria-label="Observed outcome frequencies" className="mt-4 grid gap-3 sm:grid-cols-2">{counts.map(category => {
      const frequency = sampleSize ? category.count / sampleSize : 0;
      return <li key={category.value} className="rounded-lg bg-[#0e0621] p-3">
        <div className="flex justify-between text-sm"><span>{category.label}</span><span>{category.count} · {(frequency * 100).toFixed(0)}%</span></div>
        <div role="meter" aria-label={`${category.label} observed frequency`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frequency * 100)} className="mt-2 h-2 overflow-hidden rounded bg-white/10"><div className="h-full bg-[#e57fab]" style={{ width: `${frequency * 100}%` }} /></div>
      </li>;
    })}</ul>
    <p role="status" aria-live="polite" className="mt-3 rounded-lg bg-[#211638] p-3 text-sm">{experiment === 'coin_flip' ? `Heads in this sample: ${((heads?.count ?? 0) / sampleSize * 100).toFixed(0)}% (theoretical probability: 50%).` : `Each face has theoretical probability: 16.7%.`} Sample size: {sampleSize}.</p>
    <button type="button" onClick={() => {setSampleSize(1);onStateChange?.({sampleSize:1});}} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-sm">Reset simulation</button>
  </section>;
}

export function StateMachineVisualizer({ config, state, onStateChange }: WidgetProps) {
  const states = config.states ?? [];
  const transitions = config.transitions ?? [];
  const initial = config.initial_state ?? states[0] ?? '';
  const [current, setCurrent] = useState(state?.machineState && states.includes(state.machineState) ? state.machineState : initial);
  const options = transitions.filter(transition => transition.from === current);
  return <section className="mt-8" aria-labelledby="state-machine-heading">
    <h3 id="state-machine-heading" className="text-lg font-medium">{config.prompt || 'Explore the state machine'}</h3>
    <p className="mt-2 text-sm text-[#b7adcc]">Choose an input available from the current state to follow a transition.</p>
    <ol aria-label="Machine states" className="mt-5 flex flex-wrap gap-2">{states.map(state => <li key={state} aria-current={state === current ? 'step' : undefined} className={`rounded-full border px-4 py-2 text-sm ${state === current ? 'border-[#efc778] bg-[#6350c8]' : 'border-white/10 bg-[#0e0621]'}`}>{state}{state === initial ? ' · start' : ''}</li>)}</ol>
    <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-[#0e0621] p-3 text-sm">Current state: {current}</p>
    {options.length ? <div role="group" aria-label={`Inputs available from ${current}`} className="mt-3 flex flex-wrap gap-2">{options.map((transition, index) => <button key={`${transition.input}-${index}`} type="button" onClick={() => {setCurrent(transition.to);save(state,{machineState:transition.to},onStateChange);}} className="rounded-lg bg-[#6350c8] px-3 py-2 text-sm">Input {transition.input} → {transition.to}</button>)}</div> : <p className="mt-3 text-sm text-[#b7adcc]">No transitions leave this state.</p>}
    <button type="button" onClick={() => {setCurrent(initial);onStateChange?.({machineState:initial});}} className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-sm">Reset machine</button>
  </section>;
}

export function ClassificationExercise({ config, state, onStateChange }: WidgetProps) {
  const categories = config.categories ?? [];
  const items = config.classify_items ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>(state?.classifications ?? {});
  const [checked, setChecked] = useState(false);
  const complete = items.every(item => answers[item.label]);
  const score = classificationScore(answers, items);
  return <section className="mt-8" aria-labelledby="classification-exercise-heading">
    <h3 id="classification-exercise-heading" className="text-lg font-medium">{config.prompt || 'Classify each example'}</h3>
    <p className="mt-2 text-sm text-[#b7adcc]">Choose a category for each example, then check your classifications.</p>
    <ul aria-label="Available categories" className="mt-3 flex flex-wrap gap-2">{categories.map(category => <li key={category.name} className="rounded-full bg-[#211638] px-3 py-1 text-sm">{category.name}{category.description ? ` · ${category.description}` : ''}</li>)}</ul>
    <ul className="mt-4 space-y-3">{items.map((item, index) => {
      const correct = answers[item.label] === item.category;
      return <li key={`${index}-${item.label}`} className="grid gap-2 rounded-lg bg-[#0e0621] p-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <span>{item.label}</span>
        <select aria-label={`Category for ${item.label}`} value={answers[item.label] ?? ''} onChange={event => { const next={...answers,[item.label]:event.target.value};setAnswers(next);save(state,{classifications:next},onStateChange);setChecked(false); }} className="rounded bg-[#211638] p-2">
          <option value="">Choose category</option>{categories.map(category => <option key={category.name} value={category.name}>{category.name}</option>)}
        </select>
        {checked && <p className="text-sm sm:col-span-2">{correct ? 'Correct.' : `Correct category: ${item.category}.`}</p>}
      </li>;
    })}</ul>
    <p role="status" aria-live="polite" className="mt-3 min-h-6 text-sm">{checked ? `${Math.round(score * 100)}% correct.` : complete ? 'Ready to check.' : 'Choose a category for each example.'}</p>
    <div className="mt-3 flex gap-2"><button type="button" disabled={!complete} onClick={() => setChecked(true)} className="rounded-lg bg-[#6350c8] px-3 py-2 text-sm">Check classifications</button><button type="button" onClick={() => { setAnswers({}); setChecked(false);onStateChange?.({classifications:{}}); }} className="rounded-lg border border-white/15 px-3 py-2 text-sm">Reset answers</button></div>
  </section>;
}
