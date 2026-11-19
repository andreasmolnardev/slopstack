# Widget development

Widgets are trusted application components selected by a stable identifier and configured with validated JSON. A widget must define its input/state shape, reset behavior, serialization and restoration behavior, accessible descriptions, and tests. Model output must never be evaluated as application code.

Current lesson renderer identifiers: `explanation`, `model`, `reflection`, `number_line`, `binary_explorer`, `matching`, `timeline`, `function_plotter`, `geometry_explorer`, `vector_visualizer`, `logic_gates`, `algorithm_step_visualizer`, `probability_simulation`, `state_machine_visualizer`, and `classification`. The catalog now has 15 registered types, the minimum requested in the product specification. All three newer widgets use strict versioned configs and deterministic controls.

## Geometry explorer

`geometry_explorer` uses widget version `1`. Its strict config accepts `side_a` and `side_b` (numbers from 0.5 to 20), `angle_degrees` (15 to 165), and an optional `prompt` (up to 240 characters). The learner can adjust both sides and the included angle; the trusted renderer recalculates the third side with the law of cosines and the area with the triangle-area formula. Reset restores the configured values. The SVG names each vertex and side and exposes a text summary for screen readers; slider labels and live metrics do not rely on color. Go tests reject invalid versions, types, bounds, unknown fields, and overlong prompts. Frontend math tests cover a 3-4-5 right triangle and an equilateral triangle.

## Vector visualizer

`vector_visualizer` version `1` accepts `{vector_x, vector_y, axis_limit, prompt?}`. The two components must be numbers in `[-10, 10]`; the axis limit must be in `[2, 10]` and contain both components. The interactive axes redraw from those initial components, show magnitude and direction as live text, and reset to the configured vector. Example: `{ "type": "vector_visualizer", "version": 1, "config": { "vector_x": 3, "vector_y": 4, "axis_limit": 5 } }`. The accessible SVG has a full text description, and both components have labeled keyboard-operable range inputs.

## Logic gates

`logic_gates` version `1` accepts `{gate, prompt?}`, with `gate` restricted to `AND`, `OR`, `XOR`, `NOT`, or `XNOR`. Input toggles recompute a boolean output; `NOT` exposes only input A. Example: `{ "type": "logic_gates", "version": 1, "config": { "gate": "XOR" } }`. Inputs are labeled native checkboxes, the output is announced as a live status, and reset returns both inputs to false.

## Binary search visualizer

`algorithm_step_visualizer` version `1` accepts `{items, target, prompt?}`. `items` is a strictly increasing array of 3–20 integers from 0 through 999, and `target` is an integer in that range. The renderer shows one deterministic midpoint check at a time, dims discarded values, and supports reset. Example: `{ "type": "algorithm_step_visualizer", "version": 1, "config": { "items": [2, 5, 8, 12, 17, 23, 31], "target": 17 } }`. Current step feedback is announced through a live status; values are in an ordered list and remain readable without color.

The geometry, vector, logic-gate, and binary-search widgets have deterministic math/trace tests; their server schemas reject unsupported versions, unknown fields, bad types, and out-of-range values. Production course generation is told the exact schema and keeps model output restricted to registered widget IDs.

## Probability simulation

`probability_simulation` version `1` accepts `{experiment, trials, seed, prompt?}`. `experiment` is `coin_flip` or `die_roll`, `trials` is 10–200, and `seed` is an integer from 1 through 2,147,483,647. The learner changes sample size to see the observed frequencies converge around the theoretical probabilities. A seeded linear congruential sequence makes each configured sample repeatable; reset returns to the first trial. Example: `{ "type": "probability_simulation", "version": 1, "config": { "experiment": "coin_flip", "trials": 100, "seed": 42 } }`. Frequency meters expose names and numeric values to assistive technology.

## State machine visualizer

`state_machine_visualizer` version `1` accepts `{states, initial_state, transitions, prompt?}`. There are 2–8 unique state labels (up to 40 characters), a declared initial state, and 1–20 transitions of `{from, input, to}`. States must exist and each input is unique within its source state, making the machine deterministic. The current state is announced and only its outgoing inputs are offered; reset returns to the initial state. Example: `{ "type": "state_machine_visualizer", "version": 1, "config": { "states": ["even", "odd"], "initial_state": "even", "transitions": [{ "from": "even", "input": "1", "to": "odd" }, { "from": "odd", "input": "1", "to": "even" }] } }`.

## Classification exercise

`classification` version `1` accepts `{categories, classify_items, prompt?}`. Categories have unique names (2–5 entries) and optional short descriptions. There are 3–12 uniquely labeled items, each referencing a declared category. Learners select one category per item, check the result, and can reset all answers. Example: `{ "type": "classification", "version": 1, "config": { "categories": [{ "name": "Solid" }, { "name": "Liquid" }], "classify_items": [{ "label": "Ice", "category": "Solid" }, { "label": "Water", "category": "Liquid" }, { "label": "Steam", "category": "Liquid" }] } }`. Every item has a labeled native select; correctness is reported with text and a live status. As with all scene widget configuration, this activity is for practice and is not a protected assessment-answer store.

All three new types have server schema and frontend behavior tests. Course generation receives each exact config shape, and generated content must use one of the 15 registered identifiers. Widget state resets deterministically; persistence of in-progress widget state between sessions remains future work. The broader 15–20 widget target has reached its minimum count, while sentence construction, vocabulary matching, and several other requested families remain future catalog work.
