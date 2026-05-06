# Post-Reset Bootstrap

Use this only after the reset has completed and the team is ready to recreate the first live academy owner/admin path.

The bootstrap script defaults to dry-run. It never deletes data. It only creates a missing Auth user and merges the academy, owner user, and owner membership documents when `--write` is passed.

## Prerequisites

- Firestore export completed and recorded.
- Firebase Auth user review/export completed and recorded.
- Reset execution completed.
- Firebase project confirmed as `miami-e2e`.
- Firestore rules, indexes, Cloud Functions, project config, and billing config confirmed unchanged.
- Owner/admin email and intended academy id/name confirmed.

## Dry-Run First

Run dry-run before any write:

```bash
node scripts/bootstrap-live-academy.mjs \
  --academy-id academy_live_main \
  --academy-name "Miami Academy" \
  --owner-email owner@example.com \
  --owner-display-name "Miami Owner"
```

Dry-run should print a JSON summary with:

- `mode: "dry-run"`
- `readOnly: true`
- Auth user action: `found` or `would-create`
- Planned Firestore operations for `academies`, `users`, and `academyMemberships`
- Safety check result

If the Auth user does not exist, dry-run may show `would-create`. A password is only required for the later write command that creates the Auth user.

## Write Command

Run write only after dry-run output is reviewed:

```bash
node scripts/bootstrap-live-academy.mjs \
  --write \
  --academy-id academy_live_main \
  --academy-name "Miami Academy" \
  --owner-email owner@example.com \
  --owner-display-name "Miami Owner" \
  --password "replace-with-temporary-password"
```

If the Auth user already exists, the script finds it and does not require `--password`. If the Auth user is missing, `--password` is required so the script can create it.

## Expected Firestore Docs

The write command should create or merge:

- `academies/{academyId}`
- `users/{uid}`
- `academyMemberships/{academyId}_{uid}`

Expected owner membership fields include:

- `academyId`
- `uid`
- `email`
- `displayName`
- `role: "owner"`
- `status: "active"`
- `permissions.canManageAttendance`
- `permissions.canAddStudent`
- `permissions.canEditStudent`
- `permissions.canDeleteStudent`
- `permissions.canEditLesson`
- `permissions.canDeleteLesson`
- `permissions.canCreateLessonDirectly`
- `permissions.requiresLessonApproval`

Existing `createdAt` values are preserved when documents already exist. `updatedAt` is refreshed only in write mode.

## Safety Behavior

The script stops before writing if:

- `--academy-id` is missing.
- `--academy-id academy_default` is used.
- `--academy-name` is missing.
- `--owner-email` is missing or invalid.
- `serviceAccountKey.json` is missing or unreadable.
- The service account project is not `miami-e2e`.
- A missing Auth user would be created with `--write` but no `--password` was provided.
- The existing Auth user has a protected non-owner role such as `student`, `teacher`, or `staff` in custom claims, `users/{uid}`, or any `academyMemberships` document.

Optional local safety assertions:

```bash
node scripts/bootstrap-live-academy.mjs --self-test
```

## Smoke Test After Bootstrap

After write mode completes:

- Sign in as the owner/admin.
- Confirm dashboard opens.
- Confirm the selected academy is the bootstrapped academy.
- Confirm `users/{uid}` exists and has `role: "admin"`.
- Confirm `academyMemberships/{academyId}_{uid}` exists with `role: "owner"`.
- Confirm owner/admin can manage private students.
- Confirm owner/admin can manage private lesson slots.
- Confirm owner/admin can create or view a group class.
- Confirm cross-academy access remains denied.
- Confirm no payment behavior was introduced.

## Stop-The-Line Criteria

Stop immediately if:

- Dry-run output is not understood.
- Project is not confirmed as `miami-e2e`.
- The owner/admin email belongs to an existing student, teacher, staff, or other non-owner account.
- The script reports unexpected planned changes.
- The write command would create an Auth user without a temporary password.
- Any expected Firestore doc path differs from the intended academy id or owner uid.
- Owner/admin cannot sign in after bootstrap.
- Dashboard access or academy scoping fails after bootstrap.
