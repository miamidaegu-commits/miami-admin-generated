# First Live Data Onboarding

Use this runbook after a future reset, owner/admin bootstrap, and post-bootstrap smoke verification. It documents the first real operational records and smoke checks needed to prove the app is ready for live use.

Do not use this runbook to reset data. Do not change Firestore rules or business logic during onboarding.

## 1. Preconditions

Complete these before creating first live data:

- Reset completed and confirmed.
- `scripts/bootstrap-live-academy.mjs --write` completed for the live academy.
- `scripts/smoke-post-bootstrap.mjs` passed for the live academy and owner/admin email.
- Owner/admin can log in through the app and open the dashboard.
- `linkStudentAccount` callable is deployed and ready in the expected Firebase project/region.
- Firebase project is confirmed as `miami-e2e`.
- Firestore rules, indexes, Cloud Functions, Firebase project config, and billing config are unchanged from the approved deployment.
- The live academy id is known and is not `academy_default`.

Stop here if any precondition is incomplete.

## 2. First Teacher Setup

Goal: create the first real teacher identity and academy membership so teacher-scoped dashboard views, lessons, groups, and slots filter correctly.

Create or confirm the Firebase Auth user:

- Email belongs to the real teacher.
- Temporary password or provider setup is handled through the approved Auth process.
- UID is recorded for Firestore document checks.
- The account is not reused from a student or unrelated staff account.

Create or confirm `users/{uid}`:

- `uid` equals the Auth UID.
- `email` equals the teacher Auth email.
- `displayName` is the teacher's display name.
- `role` is `teacher`.
- `isActive` is `true`.
- `teacherName` is the normalized teacher key used by lessons and classes.
- `lastSelectedAcademyId` is the live academy id.

Create or confirm `academyMemberships/{academyId}_{uid}`:

- `academyId` equals the live academy id.
- `uid` equals the Auth UID.
- `email` equals the teacher Auth email.
- `role` is `teacher`.
- `status` is `active`.
- `teacherName` matches `users/{uid}.teacherName`.
- `permissions` exists and includes all known permission keys.

Teacher name normalization:

- Use a single lowercase, trimmed teacher key everywhere.
- The same value must appear in `users/{uid}.teacherName`, `academyMemberships/{academyId}_{uid}.teacherName`, private student `teacher`, student package `teacher`, group class `teacher`, group lesson `teacher`, and private lesson slot `teacher`.
- Do not mix display name casing with teacher key casing.
- If the teacher should appear as "Jane Kim", choose a stable operational key such as `jane-kim` or `jane kim`, then reuse it exactly.

Teacher permissions checklist:

- `canManageAttendance`
- `canAddStudent`
- `canEditStudent`
- `canDeleteStudent`
- `canEditLesson`
- `canDeleteLesson`
- `canCreateLessonDirectly`
- `requiresLessonApproval`

For the first live teacher, choose the intended operational permissions deliberately. If the teacher should only view assigned work, leave management permissions false. If the teacher should manage attendance or create lessons, explicitly record those choices.

Smoke checks:

- Teacher can log in.
- Teacher lands in the correct academy.
- Teacher dashboard shows only records matching their `teacherName`.
- Teacher cannot see cross-academy records.

## 3. First Private Student Setup

Goal: create the first real private student, grant private booking eligibility, and link the student Auth account safely.

Create the `privateStudents/{studentId}` record through the dashboard:

- `academyId` equals the live academy id.
- Student name/contact fields are correct.
- `teacher` equals the normalized teacher key.
- Student notes or operational fields are real, not test placeholders.

Create the first private student package through the dashboard:

- `studentId` matches the private student.
- `academyId` equals the live academy id.
- `packageType` is private.
- `teacher` and `teacherName` equal the normalized teacher key.
- Package status is active if the student should be eligible immediately.
- Counts, dates, expiration, and attendance fields match the real agreement.

Expected `studentPrivateAccessSummary` result:

- Document id: `studentPrivateAccessSummary/{academyId}__{studentId}`.
- `academyId` equals the live academy id.
- `studentId` equals the private student id.
- `teacherKeys` includes the normalized teacher key.
- `activePackageIds` includes the active private package id.

Student account link through dashboard:

- Use the approved student account linking UI/flow.
- Confirm `linkStudentAccount` callable succeeds.
- Confirm Firebase Auth user exists for the student email.
- Confirm `users/{uid}` exists with `role` set to `student`.
- Confirm `academyMemberships/{academyId}_{uid}` exists with `role` set to `student`.
- Confirm membership `studentId` equals the private student id.
- Confirm membership `status` is `active`.

Student login smoke:

- Student can log in.
- Student reaches the student booking UI.
- Student sees only eligible private/group booking data for their academy and linked student id.
- Student cannot access dashboard admin routes.

## 4. First Private 1:1 Slot Setup

Goal: prove the live private lesson slot reservation/cancel flow works end to end.

Admin or teacher creates the private slot:

- Slot is created in `privateLessonSlots`.
- `academyId` equals the live academy id.
- `teacher` equals the normalized teacher key.
- Date/time/duration are real.
- Initial `status` is `open`.
- `reservedStudentId` and `reservationId` are empty until reservation.

Student sees the eligible slot:

- Student is linked to the private student.
- `studentPrivateAccessSummary/{academyId}__{studentId}` exists.
- `teacherKeys` includes the slot teacher key.
- Slot appears in the student booking UI.

Student reserves:

- Reservation creates/updates `privateLessonReservations/{academyId}__{slotId}__{studentId}`.
- Slot changes to reserved.
- Slot `reservedStudentId` equals the student id.
- Slot `reservationId` matches the reservation document id.
- Reservation status is active.

Student cancels:

- Reservation status changes to cancelled or the approved cancellation state.
- Slot returns to the expected available/cancelled state according to the implemented flow.
- Dashboard reflects the cancellation.

Dashboard reservation visibility:

- Owner/admin sees the slot and reservation state.
- Teacher sees the slot only if it matches their `teacherName`.
- No cross-academy reservations are visible.

## 5. First Group Setup

Goal: prove the first live group class, group student access, and group lesson booking flow works end to end.

Create the first `groupClasses` record through the dashboard:

- `academyId` equals the live academy id.
- Group name/subject are real.
- `teacher` equals the normalized teacher key.
- Schedule fields are correct.
- Capacity is correct.

Create or generate `groupLessons`:

- Lessons belong to the live academy id.
- Each lesson references the correct group class id.
- `teacher` equals the normalized teacher key.
- Date/time fields are correct.
- Capacity/reservation fields match the group class policy.

Register the first group student:

- Use the dashboard group student flow.
- Student is the intended real private student or approved group-only student.
- `groupStudents/{groupStudentId}` has the live `academyId`.
- `groupClassId` points to the first group class.
- `studentId` points to the correct student.
- Student and registration statuses are active when booking should be allowed.
- Package/access fields match the real enrollment.

Expected `studentGroupAccessSummary` result:

- Document id: `studentGroupAccessSummary/{academyId}__{studentId}`.
- `academyId` equals the live academy id.
- `studentId` equals the linked student id.
- `groupClassIds` includes the first group class id.

Student sees eligible group lesson:

- Student logs in.
- Student booking UI shows the eligible group lesson.
- The lesson belongs to the expected group class and live academy.

Student reserves/cancels:

- Reservation creates/updates `groupLessonReservations`.
- Reservation points to the correct lesson, group class, academy, and student.
- Lesson reserved count/status changes according to the implemented flow.
- Student can cancel according to the intended rules.
- Owner/admin dashboard reflects reservation and cancellation state.

## 6. Smoke Checklist

Admin smoke:

- Owner/admin can log in.
- Dashboard opens.
- Current academy is the live academy.
- Admin can view the first teacher, private student, private package, private slot, group class, group student, and reservations.
- Admin can create or inspect both private and group flows.

Teacher smoke:

- Teacher can log in.
- Teacher sees only data matching their normalized `teacherName`.
- Teacher can access only intended actions based on permissions.
- Teacher cannot see cross-academy data.

Student smoke:

- Student can log in.
- Student booking UI opens.
- Student sees eligible private 1:1 slot.
- Student can reserve and cancel private 1:1 slot.
- Student sees eligible group lesson.
- Student can reserve and cancel group lesson.
- Student cannot see another student's data.
- Student cannot access admin dashboard routes.

Cross-academy privacy smoke:

- No view shows records from another academy.
- Direct links or stale sessions do not reveal another academy's students, lessons, slots, packages, memberships, or reservations.
- Reservations and summaries always use the live academy id.

No payment behavior:

- No payment capture, payment link, invoice, or payment status behavior is introduced during onboarding.
- Package creation reflects operational entitlement only.
- Any payment handling remains outside this MVP flow until separately implemented and approved.

## 7. Stop-The-Line Criteria

Stop onboarding immediately if any of the following occur:

- Student cannot log in.
- Teacher cannot log in.
- Owner/admin cannot log in.
- `academyMemberships/{academyId}_{uid}` is missing for owner/admin, teacher, or student.
- `studentPrivateAccessSummary/{academyId}__{studentId}` is missing when private booking should be eligible.
- `studentGroupAccessSummary/{academyId}__{studentId}` is missing when group booking should be eligible.
- Teacher key is wrong, mixed case unexpectedly, blank, or inconsistent across documents.
- Any document uses the wrong `academyId`.
- Any intended admin, teacher, or student flow returns permission denied.
- Any cross-academy data is visible.
- Private slot reservation does not create a paired reservation and slot state.
- Group lesson reservation does not create the expected reservation state.
- Cancellation does not return the UI and documents to the expected state.
- Any payment behavior appears.

Record the failed step, the exact account used, the document paths checked, and the observed error before continuing.
