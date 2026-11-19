# Grounded generation and offline learning

## Decision

Course generation accepts bounded owner-owned source and concept selections plus difficulty and target session length. The job snapshots this context so retries and startup recovery use the same inputs; generated knowledge units keep course, module, and source provenance. Source deletion removes linked concepts and podcasts and redacts matching source snapshots from learning jobs.

Lesson downloads are explicit user actions. The browser stores complete lesson content and resume state in IndexedDB with owner/course keys. Progress saves online when possible and queues locally for retry after reconnection. Account changes clear that account's offline library.

Podcast scripts are generated as separate outline and dialogue stages, persisted as owner-owned episodes, and validated before publication. Piper synthesizes turns when requested by the browser; this iteration does not persist an assembled audio file. Language speaking reuses saved English vocabulary, browser WAV capture, Whisper transcription, and owner-scoped evidence. It scores text match only.

## Rationale

Explicit bounded selections keep user data scoped, limit prompt size, and allow recoverable jobs without relying on mutable UI state. User-initiated local downloads make the offline data boundary clear and allow progress to sync through the existing owner-checked endpoint. Staged podcast generation provides a reviewable transcript before speech synthesis.

## Consequences

Generated scripts and transcripts are available without Piper, while audio playback requires a configured, reachable Piper service. Narration and assessment submission are not available offline. Rich host personas, assembled audio storage, learner-history personalization, and media deletion policies remain future work.
