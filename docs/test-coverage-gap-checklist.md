# Test Coverage Gap Checklist

Use this checklist before release sign-off to separate automated release gates from manual approval steps.

## Already Automated

The release gate runs these checks through `npm run verify:all`:

- E2E build with the `miami-e2e` Firebase config.
- Hosted smoke for admin dashboard, student booking, public `/classes`, teacher dashboard, and route refresh behavior.
- Student login invitation flow, including callable success and protected-role rejection.
- Student group lesson booking, cancellation, history visibility, and fail-closed membership behavior.
- Private 1:1 slot booking, cancellation pairing, eligibility, and tenant-scope checks.
- Admin student history access and teacher/student denial.
- Role-based 오늘의 일정 coverage for admin, teacher, student, and empty state.
- 오늘의 영상 / dailyMaterials coverage for admin publish/edit behavior, student published visibility, draft hiding, and cross-academy isolation.
- Public class intro page, login integration, social-link behavior, and protected-route checks.
- Built `dist/` scan for sensitive server/admin tokens and local/dev project references, with a documented allowance for Firebase Auth SDK's embedded OAuth `localhost` fallback string.
- Safe operations-script syntax checks plus `bootstrap-live-academy --self-test`.

## Remaining Manual Checks

These checks remain manual because they need human review, production credentials, or release timing judgment:

- Review Firebase Hosting release channel and final deployed URL before promoting.
- Confirm real academy owner/admin account access with an approved operator.
- Review production Firestore/Auth audit output before any reset planning.
- Confirm rollback/export locations and retention expectations with the operator.
- Confirm social links and public copy with the academy before hosting deploy.
- Review Playwright traces/screenshots manually when a release test fails.

## Never Fully Automate Destructively

These actions must remain explicit manual approval steps and are not included in `verify:all`:

- Firestore export.
- Firestore reset/delete.
- Auth user deletion.
- `bootstrap-live-academy --write`.
- Firestore import/rollback.
- Any broad data deletion, reset, or tenant migration write.

## Recommended Release Gate

Run the full safe release gate:

```sh
npm run verify:all
```

If it fails, rerun the smallest failing command first, fix the issue, then rerun `npm run verify:all` before release sign-off.
