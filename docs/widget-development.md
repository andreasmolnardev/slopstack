# Widget development

Widgets are trusted application components selected by a stable identifier and configured with validated JSON. A widget must define its input/state shape, reset behavior, serialization and restoration behavior, accessible descriptions, and tests. Model output must never be evaluated as application code.

Current lesson renderer identifiers: `explanation`, `model`, `reflection`, `number_line`, `binary_explorer`, `matching`, `timeline`, and `function_plotter`. The latter five are small interactive primitives; they do not yet constitute the full 15–20 widget catalog in the product specification. Keep LLM output limited to these registered names.
