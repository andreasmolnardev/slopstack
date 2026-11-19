# Grounded generation and offline learning

## Decision

Course generation accepts bounded owner-owned source and concept selections plus difficulty and target session length. The job snapshots this context so retries and startup recovery use the same inputs; generated knowledge units keep course, module, and source provenance. Source deletion removes linked concepts and podcasts and redacts matching source snapshots from learning jobs.

Lesson downloads are explicit user actions. The browser stores lesson content and resume state in IndexedDB with owner/course keys. Before storage, it strips private assessment answers and rationales from downloaded questions. Offline quiz answers are held in a separate owner-keyed queue and are sent to the server for grading only after the same account is authenticated and connectivity is restored. Each queued attempt has a stable request ID so a retry after a lost response returns the original grading result. Removing a download also removes its queued assessments; switching accounts leaves each owner's local data isolated.

Podcast scripts are generated as separate outline and dialogue stages, persisted as owner-owned episodes, and validated before publication. Piper synthesizes turns when requested by the browser; this iteration does not persist an assembled audio file. Language speaking reuses saved English vocabulary, browser WAV capture, Whisper transcription, and owner-scoped evidence. It scores text match only.

## Rationale

Explicit bounded selections keep user data scoped, limit prompt size, and allow recoverable jobs without relying on mutable UI state. User-initiated local downloads make the offline data boundary clear and allow progress and answer submissions to sync through owner-checked endpoints. The browser never grades offline answers or stores an answer key. Staged podcast generation provides a reviewable transcript before speech synthesis.

## Consequences

Generated scripts and transcripts are available without Piper, while audio playback requires a configured, reachable Piper service. Offline assessment feedback and evidence are unavailable until authenticated sync succeeds; the local answer queue survives reconnect failures. Narration/media downloads, rich host personas, assembled audio storage, learner-history personalization, and media deletion policies remain future work.
