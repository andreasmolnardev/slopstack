# Decision 002: Persist lesson resume state separately from evidence

## Context

Learners need to resume a course at a scene and time position without creating an evidence record for every playback tick. Evidence should describe learning events, while resume state is frequently overwritten.

## Decision

Store one `course_progress` record per owner and course. Save on pause, seek, scene transition, completion, and periodically during playback. Flatten scenes across modules in authored order. Use declared scene durations, default to 30 seconds when missing or invalid, and map seeks to a scene-local time. Reset widget state after seeking so replay starts from a deterministic initial state. Required reflection checkpoints must be submitted before scene completion is recorded.

## Consequences

Progress remains private to the owner and is exported/imported with the learning archive. It is separate from evidence and mastery. Prepared narration is split into per-scene WAV segments; the browser uses each segment's media duration to drive timeline progress and synchronization. Timed phrase-level captions, event replay, narrator selection, and player modes are not implemented yet.
