# Outline-first curriculum generation

## Decision

Course generation uses two OpenAI-compatible calls inside the existing persistent job. The first call returns bounded prerequisites, knowledge units, an ordered module list, and observable objectives. The second call creates scenes and assessments against that outline. The server rejects malformed references or lesson output that changes the approved module IDs, titles, objectives, or knowledge-unit references.

The learner's stated goal is stored in the job payload and passed into both stages so retries and startup recovery retain the original intent. When no provider is configured, local development continues to use a deterministic fixture.

## Rationale

Separating curriculum planning from lesson authoring makes prerequisite order and objective coverage explicit. Strict validation keeps the second generation stage from silently changing that plan and protects the trusted widget runtime from arbitrary component output.

## Consequences

Provider-backed generation costs two requests and can fail if either response is invalid; existing job retries cover transient and malformed results. The current outline is stored with course content, but generated knowledge units and prerequisite edges are not yet persisted as shared knowledge records. Source-document grounding, learner-history adaptation, and live provider verification remain future work.
