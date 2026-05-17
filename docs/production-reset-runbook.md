# Production Reset Runbook

This runbook resets the Firebase project `miamiacademyschedule`.

## Safety Rules

- Do not commit `serviceAccountKey.json`, `serviceAccountKey.prod.json`, or any other service account key.
- Do not commit `dist/` build output.
- If existing `dist/` files are already tracked by Git, restore any build changes before committing or remove them from the index in a separate cleanup.
- Do not change Firebase project settings as part of this reset.
- Always run a backup before a destructive reset.
- The destructive reset only runs when `ALLOW_PRODUCTION_RESET=daegumiami`.
- The admin account `miamidaegu@gmail.com` is preserved by the data reset.

## Service Account

Place the production service account key outside version control. The scripts look for credentials in this order:

1. `FIREBASE_SERVICE_ACCOUNT_PATH`
2. `GOOGLE_APPLICATION_CREDENTIALS`
3. `serviceAccountKey.prod.json`
4. `serviceAccountKey.json`

Every script verifies that the service account `project_id` is `miamiacademyschedule` before touching Firebase.

## Backup

Run:

```sh
npm run backup:production
```

The backup is written to `backups/production-reset/<timestamp>/` by default. It includes:

- Firestore JSON exports for the reset collections
- Auth user metadata in `authUsers.json`
- A `manifest.json`

Auth passwords cannot be exported by Firebase Admin SDK.

## Dry Run

Run:

```sh
npm run reset:production:dry
```

This reports the Firestore and Auth records that would be deleted. No data is deleted.

## Destructive Reset

Only run after a fresh backup and dry run:

```sh
ALLOW_PRODUCTION_RESET=daegumiami npm run reset:production
```

The reset deletes:

- All `users` documents except `miamidaegu@gmail.com`
- All Auth users except `miamidaegu@gmail.com`
- All documents in `privateStudents`
- All documents in `groupClasses`
- All documents in `groupStudents`
- All documents in `groupLessons`
- All documents in `lessons`
- All documents in `studentPackages`
- All documents in `creditTransactions`
- All documents in `groupLessonReservations`
- All documents in `groupLessonCancelUsage`
- All documents in `privateLessonSlots`
- All documents in `privateLessonReservations`
- All documents in `studentPrivateAccessSummary`
- All documents in `lessonRequests`

## Restore Or Repair Admin

If the admin Auth user is missing, or if the password needs to be rotated:

```sh
ADMIN_PASSWORD='새비밀번호' npm run reset:production:admin
```

This creates or updates `miamidaegu@gmail.com`, sets the password, enables the account, applies admin custom claims, and merges an active `users/{uid}` admin profile.

Set `PRODUCTION_ACADEMY_ID` if the admin profile must be pinned to a specific academy:

```sh
PRODUCTION_ACADEMY_ID='academy-id' ADMIN_PASSWORD='새비밀번호' npm run reset:production:admin
```

If `PRODUCTION_ACADEMY_ID` is omitted, the script preserves the existing admin `academyId` or leaves it blank for a newly created admin.

## Verification

Run:

```sh
npm run backup:production
npm run reset:production:dry
ALLOW_PRODUCTION_RESET=daegumiami npm run reset:production
ADMIN_PASSWORD='새비밀번호' npm run reset:production:admin
npm run build
git diff --check
git status --short
```

Before committing, confirm that no service account key and no `dist/` build output is staged.
