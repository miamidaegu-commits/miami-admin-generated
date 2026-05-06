# Production Reset Runbook

This runbook is a planning document for a controlled reset of the `miami-e2e` Firebase application data. It is not permission to reset anything by itself.

Do not begin reset execution until the backup, Auth review, dry-run plan, and operator sign-off are complete.

## 1. Required Prerequisites

Firestore export must be completed first.

- Use the backup checklist in `docs/firestore-backup-before-reset.md`.
- Confirm the export command completed successfully.
- Confirm the export path exists in Cloud Storage.
- Record the exact export path in the reset notes.

Firebase Authentication user review/export must be completed first.

- Firestore export does not back up Firebase Authentication users.
- Review Auth users in the Firebase Console or approved admin tooling.
- Export or record Auth users separately if they must be recoverable.
- Confirm how owner, admin, teacher, and student Auth accounts will be recreated or preserved.

Dry-run planning must be completed first.

- Run `node scripts/audit-before-reset.mjs`.
- Run `node scripts/plan-production-reset.mjs`.
- Review every `needsReview` entry before execution.

## 2. Stop-The-Line Criteria

Stop immediately if any of the following are true:

- Firebase project is not confirmed as `miami-e2e`.
- Firestore export is missing, incomplete, or not verified in Cloud Storage.
- Auth user review/export is incomplete.
- The backup path is not recorded.
- The dry-run planner reports unexpected `keepCandidate` or `needsReview` entries.
- Any operator is unsure which data is planned for reset.
- Any customer, real production, billing, source code, rules, indexes, functions, or project config item appears in the reset scope.
- The rollback plan has not been reviewed.
- The owner/admin account setup path is unknown.
- The team cannot complete post-reset smoke testing immediately after reset.

## 3. Collections Planned For Reset

The reset plan is expected to cover application data in these Firestore collections:

- `academies`
- `users`
- `academyMemberships`
- `privateStudents`
- `studentPackages`
- `lessons`
- `groupClasses`
- `groupStudents`
- `groupLessons`
- `groupLessonReservations`
- `studentGroupAccess`
- `studentGroupAccessSummary`
- `privateLessonSlots`
- `privateLessonReservations`
- `studentPrivateAccessSummary`
- `creditTransactions`
- `accountProvisioningLogs`

Before execution, compare the actual dry-run plan against this list and confirm there are no surprise collections or unknown ownership boundaries.

## 4. Auth Users Planned For Deletion

Auth users must be planned separately from Firestore data. Firestore export does not restore Firebase Auth users.

Auth accounts that are likely reset candidates include obvious test-looking users:

- `admin@example.com`
- `teacher@example.com`
- `student@example.com`
- `e2e-*`
- `qa-*`
- `private-slot-*`
- `*@example.com`

Do not remove any Auth user until the dry-run output has been reviewed and the account is explicitly approved for reset.

## 5. Data That Must Not Be Deleted

The reset must not delete or alter:

- Source code
- Firestore rules
- Firestore indexes
- Cloud Functions
- Firebase project config
- Billing config

Also do not change deployed app configuration, hosting setup, service account keys, secrets, or CI/CD settings as part of this reset unless a separate approved change exists.

## 6. Post-Reset Bootstrap Sequence

After reset execution, rebuild only the minimum viable production data needed for the app to operate.

1. Confirm Firebase project is still `miami-e2e`.
2. Confirm Firestore rules and indexes are still deployed and unchanged.
3. Create or confirm the academy record.
4. Set up the owner/admin Auth account.
5. Create the matching `users` document and `academyMemberships` owner/admin membership.
6. Set up the first teacher Auth account if teacher login is required.
7. Create the teacher `users` document and `academyMemberships` membership.
8. Create the first private student.
9. Create the first private student package or private access summary needed for booking.
10. Create the first group class.
11. Add the first group student and group package/access summary if group booking is in scope.
12. Link the first student account through the approved account-linking flow.
13. Run smoke tests before opening the project for normal use.

## 7. Owner/Admin Account Setup

Owner/admin setup must establish:

- Firebase Auth user for the owner/admin.
- Firestore `users/{uid}` profile.
- Firestore `academyMemberships/{academyId}_{uid}` document.
- Role of `owner` or approved admin equivalent.
- Active status.
- Required management permissions.
- Verified academy scoping.

Stop if the owner/admin can sign in but cannot reach the dashboard, or if the user can reach data from the wrong academy.

## 8. Teacher Setup

Teacher setup must establish:

- Firebase Auth user for the teacher.
- Firestore `users/{uid}` profile.
- Firestore `academyMemberships/{academyId}_{uid}` document.
- Role of `teacher`.
- Active status.
- Teacher identity fields used by private lessons and group classes.
- Permissions matching the intended operational role.

Confirm teacher access is academy-scoped and does not expose owner/admin-only actions unless explicitly intended.

## 9. First Private Student Setup

Private student setup must establish:

- `privateStudents/{studentId}` with the correct `academyId`.
- Teacher assignment.
- Initial package or entitlement data if the student should be able to book.
- `studentPrivateAccessSummary/{academyId}__{studentId}` if private booking is in scope.

Confirm the student appears in dashboard views and private booking eligibility behaves as expected.

## 10. First Group Class Setup

Group setup must establish:

- `groupClasses/{groupClassId}` with the correct `academyId`.
- Teacher assignment.
- Schedule fields.
- Group student registration when needed.
- Group package/access data when student booking is in scope.
- `studentGroupAccessSummary/{academyId}__{studentId}` if group booking is in scope.

Confirm group lessons and reservations are academy-scoped.

## 11. Student Account Linking

Student account linking must use the approved account-linking flow.

Confirm:

- Auth user exists for the student.
- `users/{uid}` exists.
- `academyMemberships/{academyId}_{uid}` exists.
- Membership role is `student`.
- Membership status is `active`.
- Membership points to the correct student id.
- Student dashboard routes cannot access another student's data.

## 12. Smoke Test Checklist

Run smoke tests immediately after bootstrap:

- Owner/admin can sign in and open dashboard.
- Teacher can sign in with expected permissions.
- Student can sign in and open student booking UI.
- Admin can create or view a private student.
- Admin can create or view a private lesson slot.
- Eligible student can reserve and cancel a private lesson slot.
- Forged or unpaired private reservation behavior remains denied by rules.
- Admin can create or view a group class.
- Eligible student can reserve and cancel a group lesson if group booking is enabled.
- Cross-academy access remains denied.
- No payment behavior is introduced.

Record the exact smoke test commands and results in the reset notes.

## 13. Rollback Note

Rollback through Firestore import must be planned as a separate high-impact operation:

```bash
gcloud firestore import gs://<bucket>/firestore-backups/before-prod-reset-YYYYMMDD-HHMMSS --project=miami-e2e
```

Do not run import without confirming project, database, downtime/write freeze, expected import behavior, indexes, rules, and post-import validation.

Important: Firestore import does not restore Firebase Authentication users. Auth users, provider links, custom claims, disabled state, and credentials require a separate recovery plan.
