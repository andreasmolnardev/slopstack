# Widget development

Widgets are trusted application components selected by a stable identifier and configured with validated JSON. A widget must define its input/state shape, reset behavior, serialization and restoration behavior, accessible descriptions, and tests. Model output must never be evaluated as application code.

Current lesson renderer identifiers: `explanation`, `model`, `reflection`, `number_line`, `binary_explorer`, `matching`, `timeline`, `function_plotter`, `geometry_explorer`, `vector_visualizer`, `logic_gates`, and `algorithm_step_visualizer`. The last three use strict versioned configs and deterministic controls; the catalog still has 12 of the 15–20 initial widgets requested by the product specification.

## Geometry explorer

`geometry_explorer` uses widget version `1`. Its strict config accepts `side_a` and `side_b` (numbers from 0.5 to 20), `angle_degrees` (15 to 165), and an optional `prompt` (up to 240 characters). The learner can adjust both sides and the included angle; the trusted renderer recalculates the third side with the law of cosines and the area with the triangle-area formula. Reset restores the configured values. The SVG names each vertex and side and exposes a text summary for screen readers; slider labels and live metrics do not rely on color. Go tests reject invalid versions, types, bounds, unknown fields, and overlong prompts. Frontend math tests cover a 3-4-5 right triangle and an equilateral triangle.

## Vector visualizer

`vector_visualizer` version `1` accepts `{vector_x, vector_y, axis_limit, prompt?}`. The two components must be numbers in `[-10, 10]`; the axis limit must be in `[2, 10]` and contain both components. The interactive axes redraw from those initial components, show magnitude and direction as live text, and reset to the configured vector. Example: `{ "type": "vector_visualizer", "version": 1, "config": { "vector_x": 3, "vector_y": 4, "axis_limit": 5 } }`. The accessible SVG has a full text description, and both components have labeled keyboard-operable range inputs.

## Logic gates

`logic_gates` version `1` accepts `{gate, prompt?}`, with `gate` restricted to `AND`, `OR`, `XOR`, `NOT`, or `XNOR`. Input toggles recompute a boolean output; `NOT` exposes only input A. Example: `{ "type": "logic_gates", "version": 1, "config": { "gate": "XOR" } }`. Inputs are labeled native checkboxes, the output is announced as a live status, and reset returns both inputs to false.

## Binary search visualizer

`algorithm_step_visualizer` version `1` accepts `{items, target, prompt?}`. `items` is a strictly increasing array of 3–20 integers from 0 through 999, and `target` is an integer in that range. The renderer shows one deterministic midpoint check at a time, dims discarded values, and supports reset. Example: `{ "type": "algorithm_step_visualizer", "version": 1, "config": { "items": [2, 5, 8, 12, 17, 23, 31], "target": 17 } }`. Current step feedback is announced through a live status; values are in an ordered list and remain readable without color.

These widget models have deterministic math/trace tests and their server schemas reject unsupported versions, unknown fields, bad types, and out-of-range values. Production course generation is told the exact schema and keeps model output restricted to registered widget IDs. The initial catalog now contains 12 stable IDs; matching, classification, sentence construction, state-machine, and other requested widget families remain future catalog work.
