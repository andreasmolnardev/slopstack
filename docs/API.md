# API

## Runtime

- Backend: Go and PocketBase.
- Default address: `http://localhost:8090`.
- Frontend proxy: Vite forwards `/api` to the backend.
- OpenAPI JSON: `/openapi.json`.
- OpenAPI YAML: `/openapi.yaml`.
- ReDoc: `/docs`.

## Todo example endpoints

The reference Todo module uses persisted PocketBase records through these authenticated endpoints:

```http
GET /api/todos
POST /api/todos
GET /api/todos/{id}
PATCH /api/todos/{id}
DELETE /api/todos/{id}
Authorization: Bearer <pocketbase-token>
```

Each user can list and change only their own todos. A missing or foreign todo returns `404`. Create and update bodies accept `title`, `description`, `priority`, `completed`, and `due_date`; priorities are `High`, `Medium`, or `Low`, and due dates use `YYYY-MM-DD`.

For example:

```json
{
  "title": "Design homepage mockups",
  "description": "Create the first round of homepage designs.",
  "priority": "High",
  "due_date": "2026-10-30"
}
```

Unauthenticated requests return `401`. The Huma operations define the OpenAPI contract; PocketBase routes implement the requests.

The learning route contract covers courses and versions, assessments and progress, knowledge units and edges, sources, vocabulary and grammar, adaptive practice, speech, generation jobs, review, and account learning archives. Go tests verify that every registered PocketBase learning endpoint has an authenticated OpenAPI operation. Speech synthesis is documented with an `audio/wav` response, and transcription accepts raw `audio/wav` request bytes.

## Course generation

Queue generation for an owned course with optional owner-owned sources and concepts:

```http
POST /api/learning/courses/{id}/generate
Authorization: Bearer <pocketbase-token>
Content-Type: application/json
```

The body accepts `source_ids` (up to four), `concept_ids` (up to eight), `difficulty` (`beginner`, `intermediate`, or `advanced`), and `target_minutes` (5–60). Source text and concept descriptions are bounded before entering prompts and are snapshotted in the persistent job payload so retries and startup recovery use the same context. Omitted difficulty and duration use the learner profile defaults (intermediate and 20 minutes on a new account). Unowned IDs are rejected. Poll the returned job at `/api/learning/jobs/{id}`. The trusted widget set includes `geometry_explorer` with bounded triangle side lengths and angle configuration.

`GET/PATCH /api/me/preferences` reads and partially updates the authenticated learner profile. The `/profile` screen stores interests, goals, prior knowledge, preferred language, default difficulty, target session length, narration, and captions. Course generation snapshots the relevant profile context into its persistent job so retries use the same personalization inputs.

Offline lesson downloads can optionally include Piper narration generated with the saved narration voice and speaker. Narration stays in the browser's IndexedDB, is scoped by owner/course/version, and is limited to 25 MiB per course; removing the course download also removes its narration.

## Adaptive practice

`POST /api/learning/practice/quizzes` creates a private recall quiz from `selected`, `due`, `weak`, or `mixed` knowledge units. The response contains question choices and progressive hints without answer keys. Submit choices to `POST /api/learning/practice/quizzes/{id}/submit`; the owner-scoped response includes scoring, targeted remediation, and evidence updates.

## Source editing

`GET /api/learning/sources/{id}` returns the authenticated owner's text or Markdown source. `PATCH /api/learning/sources/{id}` accepts any subset of `title`, `content`, and `source_type`; text remains capped at 1 MiB. Source corrections affect future generation context. Previously generated courses and independently edited concepts remain unchanged.

The source library can import local PDFs by extracting selectable text in the browser and posting it to `POST /api/learning/sources` as a Markdown source. Import is limited to PDF files up to 10 MiB, 200 pages, and 1 MiB of extracted text. Image-only scanned pages are not OCRed and cannot be imported until text is available.

`POST /api/learning/sources/web` fetches a public HTTP(S) page and stores its visible text as an owned Markdown source with URL provenance. It rejects redirects, non-public DNS/IP results, non-standard ports, unsupported content types, and bodies over 5 MiB; extracted text is capped at 1 MiB. Only visible text is retained; scripts and embedded active content are discarded.

## Extending a module

1. Define request and response types in the Go module.
2. Register the operation with Huma and add security metadata.
3. Enforce auth and ownership checks in the route handler.
4. Read and write PocketBase records using the current user as owner.
5. Export OpenAPI with `pnpm generate:api`.
6. Generate the client with `pnpm generate:client`.
7. Use generated client calls from the React feature.

Never treat frontend visibility as authorization. Backend `Authorize` is the enforcement point.

## Learning progress

Authenticated learners can get and update their own course resume state:

```http
GET /api/learning/courses/{id}/progress
PUT /api/learning/courses/{id}/progress
Authorization: Bearer <pocketbase-token>
```

The update body is `{ "scene_index": 1, "position_seconds": 12.5, "completed": false }`. Course ownership is checked before reading or writing progress. A foreign course returns `404`.

## Module assessment

Submit answers keyed by the generated question IDs:

```http
POST /api/learning/courses/{id}/assess
Authorization: Bearer <pocketbase-token>
Content-Type: application/json
```

For example, `{ "answers": { "question-1": "choice-id", "question-2": ["a", "b"], "question-3": true } }`. The server loads private answer keys for the current course version and records the attempt as learner evidence. Supported deterministic types are multiple choice, multiple select, true/false, numeric values with tolerance, exact short text and fill-in answers, normalized formula text, ordering, and one-to-one matching. Formula grading normalizes whitespace and common operator characters; it does not use symbolic algebra to prove equivalence.


## Audio Studio

Authenticated learners can list, create, regenerate, read, and delete podcast episodes at `/api/audio/episodes` and `/api/audio/episodes/{id}`. Creation accepts a title, topic, owner-owned `source_ids` and `concept_ids` (bounded to five and ten), and optionally `course_id` plus `module_id`. The server checks course ownership, extracts a bounded snapshot of the selected course/module objectives and scenes, and preserves that context for regeneration and archive export/import. It creates a validated outline and dialogue transcript in separate LLM stages, or a deterministic fixture if no provider is configured. Regeneration reuses saved source/concept IDs and the course snapshot. `PUT /api/audio/episodes/{id}/script` saves an edited outline and transcript for an owned episode; it applies the same structure, speaker alternation, per-turn length, and total transcript limits as generation, then recalculates the estimated duration.

`POST /api/audio/episodes/{id}/audio` synthesizes each dialogue turn with its saved host or guest voice assignment (unassigned roles use the learner's saved narration voice), joins matching PCM segments into a WAV file, and stores it on the owned episode in PocketBase. The complete file is capped at 25 MiB. `GET` on the same path streams the saved WAV and checks episode ownership. Episode responses include `audio_ready` and `audio_metadata`; changing the script or voice assignments clears the saved audio.


## Language speaking practice

To submit a transcript for an owned English vocabulary item, call `POST /api/languages/vocabulary/{id}/speaking-attempt` with `{ "transcript": "good morning" }`. The route normalizes case, whitespace, and punctuation, compares against the saved word, and stores a `speaking_attempt` row in `learner_evidence`. The `/speaking` UI first sends a WAV recording to the existing `/api/speech/transcribe` endpoint, then submits the returned transcript. This score checks text only; it is not a pronunciation or accent score.

## Knowledge evidence

`GET /api/learning/knowledge-units/{id}/evidence` lists the current learner's evidence records for an owned concept. The `/knowledge` route uses it with the knowledge-unit and relationship APIs to show searchable concept details, typed edges, related course links, and prior attempts. A concept owned by another learner returns `404`.
