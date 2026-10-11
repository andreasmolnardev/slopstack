# Ownership hooks

`go/ownership` contains opt-in helpers for PocketBase record API requests. It
assigns the authenticated user to an owner field on create, checks ownership on
update and delete, and restores protected fields from the stored record before
an update is saved.

```go
err := ownership.RegisterRequestHooks(pb, ownership.Policy{
	Collection:      "todos",
	OwnerField:      "owner",
	ProtectedFields: []string{"created_by"},
	AllowSuperusers: true,
	ValidateCreate:  validateTodoContainer,
	ValidateUpdate:  validateTodoContainer,
})
```

Each app chooses the collections, owner field, protected fields, and
superuser policy. Validation callbacks run after the generic ownership check
and field assignment/restoration. Use them for app-owned rules such as checking
that a referenced calendar, account, or parent belongs to the same user. A
callback can return a PocketBase event error (for example
`e.BadRequestError(...)`) to reject the request.

`ownership.IsOwner(record, field, userID)` is a small helper for custom route
handlers. The hooks only cover native PocketBase record API requests. Custom
Huma routes and programmatic writes must still scope reads, check ownership,
assign owners, and protect fields themselves. Collection rules remain necessary
for reads and must be configured by the app. The package does not change
existing records or schema and does not install hooks unless the app calls it.

## Behavior that stays app-owned

The current Taskboard and Piggybudget ownership hooks share the same basic
owner assignment and owner checks. Their callbacks and surrounding handlers
also enforce application rules that the generic package cannot infer:

- Todos and events must reference an owned list or calendar, and archived
  containers reject new or moved entries.
- Contacts must reference an address book owned by the current user.
- Deleting a calendar/list may be rejected while it contains entries; deleting
  a recurring event may cascade to its overrides.
- Finance APIs validate account, asset-group, checkpoint, transfer, and
  attachment relationships, and apply finance-specific transaction semantics.
- Taskboard's DAV endpoints and sync journal have protocol-specific ownership
  checks and write behavior.

Keep those checks in app callbacks and route logic. `go/ownership` is a shared
primitive; adopting it does not justify removing application policy or
replacing custom-route authorization.
