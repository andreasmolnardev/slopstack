# Testing

Run the starter checks from the repository root with `go test ./...` in `apps/server` and `pnpm test` at the root. Add focused schema, ownership, API, scene validation, and player tests alongside each feature. Real LLM and Wyoming integration checks require configured services and must be reported separately from fixture-based tests.

The backend suite includes a PocketBase test-app exercise that runs the fixture course-generation worker and verifies that the course version and persistent job state are saved. It does not prove behavior against a live LLM endpoint.

It also verifies that the learning course list returns only the authenticated user's courses and that another user's course detail request receives a not-found result.

Source import tests verify provenance creation and dependent mastery cleanup on source deletion. Knowledge edge tests verify that a user cannot connect a concept owned by another account.

Course progress tests verify resume position updates to a single owner/course row, reject cross-user reads, and exercise archive ID remapping for imported progress. The frontend timeline tests cover scene flattening, declared/default durations, seek mapping, and boundary clamping. Run them with `pnpm --filter @slopstack/web test`; the production typecheck/build is `pnpm --filter @slopstack/web build`.

Assessment tests cover deterministic scoring for nine response types, strict answer-key validation and non-disclosure in published content, owner isolation, answer persistence, version-restore key copying, and archive inclusion/remapping. The UI tests verify ordering answer initialization/reordering and matching answer updates; the player renders objective-linked controls and per-question feedback. Formula grading currently compares normalized authored forms rather than proving symbolic equivalence. Live rubric grading and question types that require diagrams, widgets, code, grammar transformation, listening, or speech are not covered.

The generation tests mock an OpenAI-compatible endpoint and verify the two-stage curriculum/lesson pipeline, learner-goal propagation, validated module/objective preservation, knowledge references, and job progress updates. This is a provider-protocol test, not live provider verification. Route-contract tests check all authenticated learning endpoints appear in OpenAPI; the frontend build verifies file-route generation and route-level code splitting.


Podcast tests verify fixture outline/transcript constraints, OpenAPI authentication, and owner-scoped episode listing/detail. Course generation tests also cover owner-scoped source/concept selection, persistent bounded context and preferences, prompt grounding, invented citation rejection, and source deletion cleanup/redaction. Offline IndexedDB tests cover user isolation, download lifecycle, progress queueing, and sync retries.

Audio Studio uses the existing authenticated Piper endpoint for per-turn playback. Fixture/provider protocol tests do not verify live LLM generation, Wyoming synthesis, audio quality, or persisted audio publication.


Speaking tests cover WAV header/sample encoding, Unicode-aware transcript normalization, transcript bounds, owner-only English vocabulary access, evidence persistence, and the authenticated OpenAPI operation. Browser recording and live Whisper/Piper behavior still require a secure-context browser and configured services.

The knowledge evidence-history route is tested for authenticated OpenAPI coverage and owner isolation. The Knowledge Map's search helper tests title/description matching and unit-type filtering; route-level browser interaction remains part of manual acceptance.

Player timeline tests verify that required reflections gate progress in Interactive mode and that Watch/Silent playback can review through without recording an empty reflection as submitted work. Caption tests cover timestamp selection, gaps, ordering, and bounds. Learner-profile tests cover legacy defaults, partial updates, and bounded values; generation tests verify profile defaults and learner context are snapshotted into persistent jobs.

Adaptive-practice tests verify private answer-key responses, selection ownership, due/weak filtering, server-side scoring, evidence creation, mastery updates, and authenticated OpenAPI entries. The browser route tree includes `/practice`; the production bundle check covers its code-split route.
