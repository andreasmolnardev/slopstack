# Decision 001: Rebuild learning archives with fresh IDs

## Context

Account archives contain linked courses, versions, concepts, source documents, graph edges, evidence, and mastery state. Restoring database IDs directly would allow references to collide with existing records and would trust owner fields from an uploaded file.

## Decision

Imports create a new set of records in a single database transaction. The authenticated account is assigned as owner, every persisted record receives a new PocketBase ID, and supported relationships are remapped through old-to-new ID maps. References to omitted or unmapped optional records are dropped. Invalid core records reject the entire import. Archive format version 1 optionally includes podcast scripts and current account preferences; old version 1 files without either field remain valid. Podcast source/concept links are remapped to imported records, and episode audio is not included.

## Consequences

An archive can be imported into the same or a different account without replacing existing records. Repeated imports intentionally create duplicates. Generated media is outside the archive format. The import endpoint accepts format version 1 and limits the body to 25 MiB and each collection to 10,000 records.
