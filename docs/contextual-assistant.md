# Contextual lesson assistant

The lesson player offers five help actions: explain the current scene, give another example, explain a learner's mistake, offer a hint, and make a related practice prompt. The authenticated endpoint accepts a course ID, flattened scene index, action, and optional learner text. It loads the course and linked concepts for the signed-in owner, then passes that context and learner text to the configured OpenAI-compatible provider. Client-supplied lesson context is never used.

Assistant replies are returned to the browser and are not saved into the course or learner record. With no LLM settings configured, the app uses a small scene-grounded fixture response for local development. Provider failures return an error and leave published course content unchanged.

The response is guidance, not verified grading. Learners should use course assessment feedback for scored answers.
