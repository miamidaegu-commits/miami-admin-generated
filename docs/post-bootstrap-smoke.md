# Post-Bootstrap Smoke Verification

Use this after a future reset and after `scripts/bootstrap-live-academy.mjs --write` has completed.

The smoke script is read-only. It checks that the owner/admin bootstrap path exists and is internally consistent in Firebase Auth and Firestore.

## Command

```bash
node scripts/smoke-post-bootstrap.mjs \
  --academy-id academy_live_main \
  --owner-email owner@example.com
```

Optional service account override:

```bash
node scripts/smoke-post-bootstrap.mjs \
  --academy-id academy_live_main \
  --owner-email owner@example.com \
  --service-account serviceAccountKey.json
```

## What It Verifies

- Firebase project is `miami-e2e`.
- `academy_default` is not used.
- `academies/{academyId}` exists.
- `academies/{academyId}.status` is `active`.
- Firebase Auth user exists for the owner/admin email.
- `users/{uid}` exists.
- `users/{uid}.role` is `admin`.
- `users/{uid}.lastSelectedAcademyId` matches the academy id.
- `academyMemberships/{academyId}_{uid}` exists.
- Membership role is `owner`.
- Membership status is `active`.
- Membership `permissions` includes every known permission key.
- A readiness note is present for the `linkStudentAccount` callable flow.

Known permission keys:

- `canManageAttendance`
- `canAddStudent`
- `canEditStudent`
- `canDeleteStudent`
- `canEditLesson`
- `canDeleteLesson`
- `canCreateLessonDirectly`
- `requiresLessonApproval`

## Expected Output

The script prints a JSON summary:

- `ok: true` means every read-only check passed.
- `readOnly: true` confirms no write path was used.
- `checks` lists every individual check.
- `failures` lists only failed checks.

If any check fails, the script exits non-zero.

## linkStudentAccount Readiness Note

This smoke step does not call `linkStudentAccount`. After owner/admin smoke passes, confirm the callable is deployed and then verify student account linking through the approved flow.

Recommended follow-up checks:

- Owner/admin can access the dashboard.
- Owner/admin can open the student management flow.
- `linkStudentAccount` callable is deployed in the expected region.
- A real or approved test private student can be linked.
- The resulting student Auth user, `users/{uid}`, and `academyMemberships/{academyId}_{uid}` records are scoped to the same academy.

## Stop-The-Line Criteria

Stop immediately if:

- The service account project is not `miami-e2e`.
- `academy_default` appears anywhere in the bootstrap target.
- The academy document is missing or inactive.
- The owner Auth user is missing.
- `users/{uid}` is missing or is not `role: "admin"`.
- `lastSelectedAcademyId` does not match the academy id.
- The owner membership is missing, inactive, or not `role: "owner"`.
- Any known permission key is missing from membership `permissions`.
- The team cannot confirm `linkStudentAccount` readiness before student onboarding.

## Manual Browser Smoke After Script

After the script passes:

- Sign in as owner/admin.
- Confirm dashboard opens.
- Confirm the selected academy is correct.
- Confirm private student management opens.
- Confirm private lesson slot management opens.
- Confirm group class management opens.
- Confirm no cross-academy data is visible.
