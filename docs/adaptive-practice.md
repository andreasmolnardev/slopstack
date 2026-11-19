# Adaptive practice

Starburst can build deterministic recall quizzes from a learner's knowledge library. A quiz can use explicitly selected concepts, concepts due for review, concepts with mastery at or below 60%, or a mix of due and selected concepts. Each quiz accepts up to 20 concepts.

`POST /api/learning/practice/quizzes` creates an owner-scoped quiz. The response includes prompts, choices, and two progressive hints, while the answer key remains in the private `adaptive_practice_quizzes` collection. `POST /api/learning/practice/quizzes/{id}/submit` scores a set of choices, records `adaptive_practice` evidence, and updates the concept's mastery and review schedule. A missed definition is returned as remediation after submission.

The `/practice` route offers selected, due, weak, and mixed modes. Quiz content comes from saved knowledge titles and definitions; no model service is required. Distractors use definitions from other selected concepts when available and fall back to a generic alternative when the learner has only one defined item. Adding clear definitions improves quiz quality. This first version tests definition recall and does not yet generate course-, module-, grammar-, or reasoning-specific question types.
