# Widget development

Widgets are trusted application components selected by a stable identifier and configured with validated JSON. A widget must define its input/state shape, reset behavior, serialization and restoration behavior, accessible descriptions, and tests. Model output must never be evaluated as application code.

Current lesson renderer identifiers: `explanation`, `model`, `reflection`, `number_line`, `binary_explorer`, `matching`, `timeline`, `function_plotter`, and `geometry_explorer`. The number line, binary, matching, timeline, function, and geometry widgets are interactive primitives; they do not yet constitute the full 15–20 widget catalog in the product specification. Keep LLM output limited to these registered names.

## Geometry explorer

`geometry_explorer` uses widget version `1`. Its strict config accepts `side_a` and `side_b` (numbers from 0.5 to 20), `angle_degrees` (15 to 165), and an optional `prompt` (up to 240 characters). The learner can adjust both sides and the included angle; the trusted renderer recalculates the third side with the law of cosines and the area with the triangle-area formula. Reset restores the configured values. The SVG names each vertex and side and exposes a text summary for screen readers; slider labels and live metrics do not rely on color. Go tests reject invalid versions, types, bounds, unknown fields, and overlong prompts. Frontend math tests cover a 3-4-5 right triangle and an equilateral triangle.
