# Operations Monitoring Checklist

Use this checklist after reset, bootstrap, smoke verification, and first live onboarding. It is for live operations monitoring and incident response. It does not authorize deleting data, resetting data, changing Firestore rules, or changing business logic.

## 1. Billing Budget Setup

Set up Firebase/Google Cloud billing controls before live use:

- Confirm the billing account attached to `miami-e2e`.
- Confirm who receives billing alerts.
- Create a Google Cloud budget scoped to the Firebase/GCP project.
- Include Firestore, Cloud Functions, Firebase Hosting, Authentication-related usage, Cloud Logging, and Cloud Storage where applicable.
- Confirm alert emails go to at least two operators.
- Confirm alert emails are not routed only to a personal inbox.
- Record the budget name, amount, alert recipients, and date enabled.

Recommended budget alert thresholds:

- 50 percent: early warning.
- 75 percent: operator review required.
- 90 percent: stop non-essential testing and inspect usage.
- 100 percent: incident review.
- Forecasted 100 percent: review immediately, even if actual spend is still lower.

Stop if billing is enabled but no budget alerts exist.

## 2. Cloud Functions Log Checks

Primary function to watch:

- `linkStudentAccount`

Check logs after student account linking, after failed linking attempts, and during onboarding:

- Confirm callable invocations reach the expected region.
- Confirm caller is authenticated.
- Confirm caller has active owner/admin membership for the academy.
- Confirm `academyId`, `studentId`, and normalized email are correct.
- Confirm no repeated `permission-denied`, `failed-precondition`, or `invalid-argument` errors.
- Confirm no unexpected internal errors.
- Confirm any Auth user creation/update behavior matches the operator action.

Useful log query targets:

- Function name: `linkStudentAccount`
- Severity: `ERROR`, `WARNING`
- Error strings: `permission-denied`, `failed-precondition`, `invalid-argument`, `internal`
- Student email and student id involved in the attempt
- Actor UID and academy id

Do not change code from logs alone. First collect the full context listed in section 7.

## 3. Firestore Permission-Denied Troubleshooting

When a user sees permission denied:

- Confirm the user is signed in with the intended Auth account.
- Confirm Firebase project is `miami-e2e`.
- Confirm the user's Auth UID.
- Confirm `users/{uid}` exists.
- Confirm `academyMemberships/{academyId}_{uid}` exists.
- Confirm membership `status` is `active`.
- Confirm role is correct: `owner`, `admin`, `teacher`, or `student`.
- Confirm the requested document has the expected `academyId`.
- For teachers, confirm `teacherName` matches the document teacher key.
- For students, confirm membership `studentId` matches the requested student data.
- Confirm the client route matches the user's role.
- Confirm Firestore rules deployed are the expected approved version.

Common root causes:

- Wrong Auth account.
- Missing academy membership.
- Inactive membership.
- `academyId` mismatch.
- Teacher key mismatch.
- Student linked to the wrong `studentId`.
- Attempted cross-academy access.
- Client reading a collection before membership state has loaded.

## 4. Booking Failure Troubleshooting

For private 1:1 booking failures:

- Confirm `privateLessonSlots/{slotId}` exists.
- Confirm slot `academyId` matches the student's academy.
- Confirm slot `teacher` is non-empty and normalized.
- Confirm slot `status` is `open` before reserve.
- Confirm `studentPrivateAccessSummary/{academyId}__{studentId}` exists.
- Confirm summary `teacherKeys` includes the slot teacher key.
- Confirm summary `activePackageIds` includes an active package.
- Confirm reservation id format is `{academyId}__{slotId}__{studentId}`.
- Confirm reserve/cancel happened through the paired transaction flow.

For group booking failures:

- Confirm `groupLessons/{lessonId}` exists.
- Confirm lesson `academyId` and group class id are correct.
- Confirm `studentGroupAccessSummary/{academyId}__{studentId}` exists.
- Confirm summary `groupClassIds` includes the group class id.
- Confirm `groupLessonReservations` path/id matches the expected reservation.
- Confirm capacity and cancellation state are valid.

If the intended flow returns permission denied, stop onboarding or live changes until the relevant membership, summary, and academy scope documents are reviewed.

## 5. Student Account Linking Failure Checklist

When linking fails:

- Confirm `linkStudentAccount` callable is deployed.
- Confirm the caller is logged in as owner/admin.
- Confirm caller membership is active for the target academy.
- Confirm `academies/{academyId}` exists.
- Confirm `privateStudents/{studentId}` exists.
- Confirm private student `academyId` matches target academy.
- Confirm student email is normalized and valid.
- Check whether an Auth user already exists for that email.
- If Auth user exists, confirm it is not a protected owner/admin/teacher/staff account unless that is explicitly intended.
- Confirm no other active membership already links the target student incorrectly.
- Confirm `users/{uid}` and `academyMemberships/{academyId}_{uid}` are created or updated only through the approved flow.

Collect function logs before changing code or retrying repeatedly.

## 6. Quota / Resource Exhausted Response

If Firebase or Google Cloud reports quota errors, resource exhaustion, or rate limits:

- Stop non-essential testing and repeated retries.
- Identify the product reporting quota pressure: Firestore, Auth, Cloud Functions, Hosting, Logging, or Storage.
- Record exact error code and message.
- Record time window and user/action that triggered it.
- Check billing budget status and quota dashboards.
- Check Cloud Functions concurrency/error spikes.
- Check Firestore read/write/delete usage.
- Check whether an E2E script, browser test, or manual loop is running.
- Pause bulk operations until usage is understood.
- Escalate to project owner before increasing quotas.

Do not delete data as a quota response. Prefer pausing writes, disabling UI access, or temporarily stopping non-essential scripts.

## 7. Logs To Collect Before Changing Code

Before changing code, rules, indexes, or functions, collect:

- Firebase project id.
- Exact user email and Auth UID.
- Academy id.
- Student id, teacher key, group class id, lesson id, slot id, or reservation id involved.
- Browser route and timestamp.
- Screenshot or exact UI error.
- Browser console error.
- Network request/callable response.
- Cloud Functions logs for the same timestamp.
- Firestore document snapshots for the involved paths.
- Current membership document.
- Current access summary document.
- Whether the user was admin, teacher, or student.
- Whether the issue reproduces with a fresh login.

Keep the collected context with the incident notes.

## 8. Stop-The-Line Criteria

Stop live operations and avoid further data changes if:

- Billing alert reaches 90 percent unexpectedly.
- Forecasted spend reaches 100 percent unexpectedly.
- Owner/admin cannot log in.
- More than one real user reports permission denied in intended flows.
- Any cross-academy data is visible.
- Student can see another student's data.
- Teacher can see another teacher's data unexpectedly.
- `linkStudentAccount` creates or links the wrong account.
- Booking reserve/cancel creates mismatched slot/reservation state.
- Firestore rules appear different from the approved deployed version.
- Cloud Functions are failing with repeated internal errors.
- Quota/resource exhaustion affects live users.
- Any operator is unsure whether a manual action will modify live data safely.

## 9. Non-Blocking Warnings

These warnings should be tracked but do not block live operations by themselves:

- Vite large chunk warning: build output currently reports a large JavaScript chunk. Monitor app load performance; address with code splitting later if needed.
- `firebase-functions` outdated warning: if deployment tooling reports this, schedule dependency review and test before upgrading. Do not upgrade during an incident unless the warning is the confirmed root cause.

## 10. Daily Operator Checks

Daily during the first live period:

- Confirm owner/admin login works.
- Review Cloud Functions errors for `linkStudentAccount`.
- Review Firestore permission-denied reports.
- Review booking reserve/cancel reports.
- Review billing budget status.
- Review Auth user creation/linking activity.
- Confirm no unexpected cross-academy reports.
- Confirm no payment behavior was introduced.

## 11. Weekly Operator Checks

Weekly:

- Review billing trend and forecast.
- Review Firestore read/write usage.
- Review Cloud Functions invocation/error counts.
- Review Authentication user list for unexpected test accounts.
- Review account memberships for inactive or incorrect roles.
- Review teacher `teacherName` consistency.
- Review booking reservations for stuck reserved/cancelled states.
- Confirm backups/runbooks remain current.
- Confirm indexes, rules, and functions match the approved deployment state.

## 12. Emergency Rollback / Disable Notes

Do not delete data during an incident unless a separate approved destructive plan exists.

Safer emergency options:

- Pause onboarding and booking operations.
- Ask users to stop retrying the failing action.
- Temporarily hide or disable a UI entry point through a reversible configuration or deployment if one exists.
- Disable or restrict a problematic Auth account if account compromise is suspected.
- Use the Firestore export rollback plan only after confirming import impact, downtime/write freeze, Auth recovery, and post-import validation.
- If a Cloud Function is the incident source, consider disabling the calling UI path or deploying a reviewed hotfix rather than changing data.

Rollback reminder:

- Firestore import can restore Firestore documents from an export, but it does not restore Firebase Authentication users.
- Auth users, provider links, custom claims, disabled state, and credentials require separate recovery handling.
