# Billing Data Exposure Audit

Teachers are restricted from seeing billing fields in the dashboard UI, and the
teacher package-count edit flow only writes `totalCount`, recalculated
`remainingCount`, and `updatedAt`.

True field-level privacy is not complete yet because Firestore returns whole
documents. Teacher-readable documents can still contain billing-related fields:

- `studentPackages`: teachers can read their own package docs, which may contain
  `amountPaid`, `memo`, or future billing fields.
- `privateStudents`: teacher-created/readable student docs can contain the
  legacy `paidLessons` count field.
- `groupStudents`: teacher-readable group registration docs can contain the
  legacy `paidLessons` count field.

The current change hides and strips known billing fields in the client where
teacher package rows are consumed, but that is not a security boundary. Full
privacy requires migrating billing fields to an admin-only collection such as
`studentPackageBilling/{packageId}` or `academyBillingRecords/{id}` and updating
Firestore rules so only admin/owner roles can read or write those documents.
