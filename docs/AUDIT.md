# Audit events

The shared `go/audit` package provides a small `Event` / `Logger` contract and
a PocketBase recorder for the existing `audit_logs` collection. It stores the
actor ID and action in their existing fields. The resource name, resource ID,
and caller-supplied metadata are stored in the collection's existing JSON
`metadata` field; no schema migration is needed.

```go
recorder := audit.PocketBaseRecorder{App: pb}
err := recorder.Log(ctx, audit.Event{
	ActorID:    userID,
	Action:     "invoice.exported",
	Resource:   "invoices",
	ResourceID: invoiceID,
	Metadata:   map[string]any{"format": "csv"},
})
```

Metadata is caller-controlled. Include only values that are safe to retain, such
as a format, reason code, or source label. Do not include record fields,
request bodies, credentials, tokens, email addresses, or other secrets.

Native PocketBase create, update, and delete requests can be recorded for
selected collections:

```go
if err := audit.RegisterRequestHooks(pb, recorder, audit.RequestHookConfig{
	Collections: []string{"invoices", "payments"},
	Metadata: func(action, collection, resourceID string) map[string]any {
		return map[string]any{"source": "native-api"}
	},
}); err != nil {
	return err
}
```

Hooks run after PocketBase's request pipeline succeeds. They record only the
authenticated actor ID, action, collection name, record ID, and metadata from
the callback. The callback receives no request body or record, which keeps
field values out of the default audit path. Audit write failures go to the
PocketBase application logger; they do not turn a completed record mutation
into a failed HTTP response. Programmatic writes and custom Huma routes are not
covered by these native record request hooks; call `Logger.Log` from those
paths with explicitly reviewed metadata.
