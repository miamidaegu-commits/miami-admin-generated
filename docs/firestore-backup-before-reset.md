# Firestore Backup Before Production Reset

This checklist is for backup/export readiness before any production reset work. It is intentionally manual. Do not delete data, reset data, or run import/export commands until the operator explicitly confirms the project, bucket, path, and timing.

## 1. Firebase Project Confirmation

- Target Firebase project: `miami-e2e`
- Confirm the active project before any manual export:

```bash
firebase use
gcloud config get-value project
```

Stop the line if either command points anywhere other than `miami-e2e`, or if the operator cannot confidently confirm the target project.

## 2. Firestore Database Backup Purpose

Create a point-in-time Firestore export immediately before any production reset so the database can be restored or inspected later if reset scope, timing, or expected data state is wrong.

The export is a safety checkpoint, not a reset step.

## 3. Cloud Storage Bucket Requirement

Firestore exports must be written to a Cloud Storage bucket that the `miami-e2e` project can access. Confirm:

- The bucket exists before running the export.
- The bucket is in an approved region/location for the project.
- The operator running the command has permission to write to the bucket.
- The bucket has retention/lifecycle settings appropriate for pre-reset backups.
- The bucket name and export prefix are copied exactly into the command.

Recommended bucket name format:

```text
miami-e2e-firestore-backups
```

If a different bucket is used, record the exact bucket name in the reset runbook before starting.

## 4. Recommended Backup Path Format

Use a timestamped path so each pre-reset backup is immutable and easy to identify:

```text
gs://<bucket>/firestore-backups/before-prod-reset-YYYYMMDD-HHMMSS
```

Example shape only:

```text
gs://miami-e2e-firestore-backups/firestore-backups/before-prod-reset-20260424-153000
```

## 5. Exact Manual Export Command

Run this manually only after project, bucket, path, and timing are confirmed:

```bash
gcloud firestore export gs://<bucket>/firestore-backups/before-prod-reset-YYYYMMDD-HHMMSS --project=miami-e2e
```

Replace `<bucket>` and `YYYYMMDD-HHMMSS` before running.

## 6. What This Backs Up

The Firestore export backs up Firestore document data from the `miami-e2e` Firestore database, including top-level collections and subcollections included by the export operation.

Collections that should be expected in the pre-reset audit include:

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

## 7. What This Does Not Back Up

Firestore export does not back up Firebase Authentication users. This means it does not preserve:

- Auth user accounts
- Auth UIDs outside Firestore documents
- Auth email/password credentials
- Auth provider links
- Auth custom claims
- Auth disabled state
- Auth metadata such as creation time and last sign-in time

Firestore documents may contain references to Auth users, such as `uid` or `email`, but those documents are not a substitute for an Authentication backup or review.

## 8. Separate Auth User Export Checklist

Before reset work, review Firebase Authentication separately:

- Confirm the active project is `miami-e2e`.
- Review the Authentication user list in the Firebase Console.
- Identify expected admin, teacher, student, QA, and E2E accounts.
- Record suspicious or test-looking users, including `admin@example.com`, `teacher@example.com`, `student@example.com`, `e2e-*`, `qa-*`, `private-slot-*`, and `*@example.com`.
- Export or record Auth users using an approved manual process before any reset if Auth state must be recoverable.
- Record whether custom claims are used and how they would be restored.
- Record whether provider-linked accounts exist and how they would be restored.

Stop the line if Auth users are in scope for reset and no separate Auth export/recovery plan exists.

## 9. How To Verify Export Completed

After running the manual export command:

1. Confirm the command exits successfully.
2. Confirm the Cloud Firestore export operation completes in the Google Cloud Console.
3. Confirm files exist under the exact `gs://<bucket>/firestore-backups/before-prod-reset-YYYYMMDD-HHMMSS` prefix.
4. Record the completed export path in the reset runbook.
5. Keep the terminal output or operation ID with the runbook.

Optional verification commands:

```bash
gcloud firestore operations list --project=miami-e2e
gcloud storage ls gs://<bucket>/firestore-backups/before-prod-reset-YYYYMMDD-HHMMSS/
```

## 10. Rollback / Import Note

A Firestore export can be imported later, but import is a high-impact operation and must be planned separately. Do not import into an active project without confirming:

- Target project and database
- Expected overwrite/merge behavior
- Application downtime or write freeze requirements
- Security rules and index state
- Authentication user restoration plan
- Post-import validation steps

Manual import command shape for a separate rollback runbook:

```bash
gcloud firestore import gs://<bucket>/firestore-backups/before-prod-reset-YYYYMMDD-HHMMSS --project=miami-e2e
```

Do not run import as part of backup readiness.

## 11. Stop-The-Line Criteria

Stop immediately and do not proceed with reset planning if any of the following are true:

- The active Firebase or gcloud project is not confirmed as `miami-e2e`.
- The service account or operator identity cannot be confirmed.
- The Cloud Storage bucket is missing or write access is unconfirmed.
- The backup path is not timestamped.
- The Firestore export has not completed successfully.
- The export path cannot be found in Cloud Storage.
- Firebase Authentication users are in reset scope but have no separate export/recovery plan.
- The audit script reports an unexpected project, unreadable configuration, or suspicious data that has not been reviewed.
- The rollback/import plan is unknown for data that must be recoverable.
- Any operator is unsure which data will be reset.
