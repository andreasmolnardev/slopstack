# Testing

Run the starter checks from the repository root with `go test ./...` in `apps/server` and `pnpm test` at the root. Add focused schema, ownership, API, scene validation, and player tests alongside each feature. Real LLM and Wyoming integration checks require configured services and must be reported separately from fixture-based tests.

The backend suite includes a PocketBase test-app exercise that runs the fixture course-generation worker and verifies that the course version and persistent job state are saved. It does not prove behavior against a live LLM endpoint.

It also verifies that the learning course list returns only the authenticated user's courses and that another user's course detail request receives a not-found result.

Source import tests verify provenance creation and dependent mastery cleanup on source deletion. Knowledge edge tests verify that a user cannot connect a concept owned by another account.

Course progress tests verify resume position updates to a single owner/course row, reject cross-user reads, and exercise archive ID remapping for imported progress. Archive tests also cover owner-scoped JSON export, ZIP WAV export/import, fresh podcast IDs, source/concept link remapping, preference validation/restore, and rollback when podcast data is invalid. Version 1 JSON imports without podcast or preference fields remain supported. The ZIP parser checks entry paths, WAV validity, media references, and compressed/uncompressed size limits. The frontend timeline tests cover scene flattening, declared/default durations, seek mapping, and boundary clamping. Run them with `pnpm --filter @slopstack/web test`; the production typecheck/build is `pnpm --filter @slopstack/web build`.

Assessment tests cover deterministic scoring for eleven response types, including listening choices, normalized grammar transformations, strict answer-key validation and non-disclosure in published content, owner isolation, answer persistence, version-restore key copying, and archive inclusion/remapping. The UI renders Piper-backed online listening prompts and uses installed browser speech voices for offline prompts. UI tests verify offline sanitization keeps prompt audio text while removing the answer key, ordering answer initialization/reordering, and matching answer updates. Formula grading compares normalized authored forms rather than proving symbolic equivalence. Live rubric grading and diagram, widget, code, and spoken-response question types remain uncovered.

The generation tests mock an OpenAI-compatible endpoint and verify the two-stage curriculum/lesson pipeline, learner-goal propagation, validated module/objective preservation, knowledge references, and job progress updates. This is a provider-protocol test, not live provider verification. Route-contract tests check all authenticated learning endpoints appear in OpenAPI; the frontend build verifies file-route generation and route-level code splitting.


Podcast tests verify fixture outline/transcript constraints, OpenAPI authentication, owner-scoped episode listing/detail, due-review gap ownership and snapshot reuse, course/module context bounds, and archive round trips. Course generation tests also cover owner-scoped source/concept selection, persistent bounded context and preferences, prompt grounding, invented citation rejection, and source deletion cleanup/redaction. Offline IndexedDB tests cover user isolation, download lifecycle, progress queueing, and sync retries.

Language-learning tests cover saved vocabulary example sentences, owner-scoped contextual/listening answer checks, normalized listening recall, and persisted learner evidence. Piper audio remains dependent on a configured live Wyoming service.

Offline learning tests cover private answer-key stripping before IndexedDB storage, database upgrades, owner-isolated queued answers and narration assets, versioned audio keys, course-removal cleanup, narration size bounds, reconnect-only synchronization, retry retention, single-flight submission, and server request-ID idempotency. The browser never grades an offline assessment; it sends answers to the authenticated server when connectivity and the matching owner account return.

Audio Studio uses the existing authenticated Piper endpoint for per-turn playback. Wyoming tests verify `describe`/`info` discovery, advertised voice and speaker projection/validation, and voice/speaker selection in the synthesis event. Fixture/provider protocol tests do not verify live LLM generation, Wyoming synthesis, audio quality, or persisted audio publication.

Lesson narration tests use a local Wyoming TCP fixture to verify owned-course synthesis, cache reuse, text-hash and voice misses, course-version invalidation, owner isolation, cached WAV streaming, input bounds, and the 8 MiB scene-audio limit. Web tests verify the player's scene identity/text request and cache-hit parsing without contacting a live Piper service.


Speaking tests cover WAV header/sample encoding, Unicode-aware transcript normalization, transcript bounds, owner-only English vocabulary access, evidence persistence, and the authenticated OpenAPI operation. Browser recording and live Whisper/Piper behavior still require a secure-context browser and configured services.

The knowledge evidence-history route is tested for authenticated OpenAPI coverage and owner isolation. The Knowledge Map's search tests title/description matching and unit-type filtering; graph-layout tests verify stable type clusters and viewport bounds. Route-level browser interaction remains part of manual acceptance.

Player timeline tests verify that required reflections gate progress in Interactive mode and that Watch/Silent playback can review through without recording an empty reflection as submitted work. Caption tests cover timestamp selection, gaps, ordering, and bounds. Learner-profile tests cover legacy defaults, partial updates, and bounded values; generation tests verify profile defaults and learner context are snapshotted into persistent jobs.

Learner-profile tests also cover saved Piper voice/speaker defaults, backward-compatible empty values, partial update preservation, clearing back to the configured service voice, and bounded names. The profile loads voice choices only from the authenticated Starburst Piper health API.

Adaptive-practice tests verify private answer-key responses, selection ownership, due/weak/gap filtering, owner-scoped course/module resolution, mastery-based question difficulty, prerequisite traversal with cycles, mastered-foundation exclusion and owner isolation, server-side scoring, evidence creation, mastery updates, rejection of unanswered submissions, and authenticated OpenAPI entries. The browser route tree includes `/practice`; the production bundle check covers its code-split route.

Geometry widget tests verify typed/ranged configuration, strict version and unknown-field rejection, law-of-cosines side lengths, area calculations, accessible controls, and deterministic reset values.

Vector, logic-gate, and binary-search widgets have strict configuration tests, deterministic math/trace expectations, keyboard-accessible controls, and deterministic reset behavior. The full requested 15–20 widget catalog is not yet implemented.

Source editing tests cover authenticated owner-only detail reads, patch validation, type/content correction, and preservation of source provenance metadata. Previously generated job context remains an immutable snapshot.
