# Production Deploy Runbook

Target Firebase project: `daegu-miami-production`
Production domain: `https://daegumiami.com`
Staging/e2e project: `miami-e2e`

This runbook prepares production without deleting data, resetting data, weakening tenant safety, or changing Firestore rules and Cloud Functions business logic.

## Academy private Functions IAM gate

The Academy private Preview → Assignment → Outcome deployment contract is not
authorized by the commands below. Its local v6 contract requires exact Runtime
IAM state receipts, resource-scoped Build bindings, the nine-permission Deploy
profile, immutable release/source/selector/baseline digests, exact human
principals, and an active RFC3339 UTC JIT window of at most two hours.

Organization Policy is pinned as
`OBSERVED_COMPATIBLE_WITH_EXPLICIT_CONTROLS`: the API is enabled, direct project
policy count is `0` with digest
`4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`,
and the exact `21` relevant effective records have zero failures and digest
`8fb48d51692619032166d4d8e60ea504f7973421d9e420f4a41ca5572987eb99`.
The `193`-constraint catalog digest is audit metadata only and is not an
execution-eligibility gate.

This compatibility result does not publish mutation commands by itself.
Provisioning, deployment, impersonation, and invoker publication still require
three explicit receipt-supplied human principals, an active JIT window no longer
than two hours, the exact four same-project service-account identities, zero
user-managed keys, explicit selection of the dedicated Build service account,
the complete permission audit, source binding, and compensating controls.
The approved deployment source remains the fixed `product-version` release
`c7eaa7b27fc9c5e9d74ae97043de6536f41a75db` and tree
`3b0bf8c310d7e8067ac09305dc93ec3f07090bd7`; a later contract release must not
replace this deployment-source pin with itself.
Do not replace missing principals or timestamps with placeholders, create
Eventarc service-agent bindings for the three HTTP callable targets, or widen
Storage/Artifact Registry access to project scope.

## Order

1. Confirm the active Firebase target is `daegu-miami-production` before every production command.

   ```sh
   npx firebase use prod
   npx firebase projects:list
   ```

2. Deploy Firestore rules first. Production Firestore was created in test mode, so rules must be deployed before real use.

   ```sh
   npx firebase deploy --only firestore:rules --project daegu-miami-production
   ```

3. Deploy Firestore indexes.

   ```sh
   npx firebase deploy --only firestore:indexes --project daegu-miami-production
   ```

4. Deploy the callable function used by student account linking.

   ```sh
   npx firebase deploy --only functions:linkStudentAccount --project daegu-miami-production
   ```

5. Build the production web app.

   ```sh
   npm run build:prod
   ```

6. Deploy hosting.

   ```sh
   npx firebase deploy --only hosting --project daegu-miami-production
   ```

7. Connect `daegumiami.com` in Firebase Hosting.

8. Add `daegumiami.com` to Firebase Auth authorized domains.

9. Run owner/admin bootstrap dry-run.

   ```sh
   node scripts/bootstrap-live-academy.mjs --expected-project-id daegu-miami-production --academy-id academy_daegumiami --academy-name "Daegu Miami" --owner-email "<REAL_OWNER_EMAIL>" --owner-display-name "Daegu Miami Owner"
   ```

10. Run owner/admin bootstrap `--write` only after explicit approval.

    ```sh
    node scripts/bootstrap-live-academy.mjs --expected-project-id daegu-miami-production --academy-id academy_daegumiami --academy-name "Daegu Miami" --owner-email "<REAL_OWNER_EMAIL>" --owner-display-name "Daegu Miami Owner" --password "<TEMP_OWNER_PASSWORD>" --write
    ```

11. Run post-bootstrap smoke.

    ```sh
    node scripts/smoke-post-bootstrap.mjs --expected-project-id daegu-miami-production --academy-id academy_daegumiami --owner-email "<REAL_OWNER_EMAIL>"
    ```

12. Create the first teacher/student through the approved admin UI flow.

13. Run hosted smoke against production.

    ```sh
    PLAYWRIGHT_BASE_URL=https://daegumiami.com npx playwright test tests/hosted-smoke.spec.js --project=chromium
    ```

## Combined Prepared Commands

```sh
npx firebase deploy --only firestore:rules,firestore:indexes --project daegu-miami-production
npx firebase deploy --only functions:linkStudentAccount --project daegu-miami-production
npm run build:prod
npx firebase deploy --only hosting --project daegu-miami-production
node scripts/bootstrap-live-academy.mjs --expected-project-id daegu-miami-production --academy-id academy_daegumiami --academy-name "Daegu Miami" --owner-email "<REAL_OWNER_EMAIL>" --owner-display-name "Daegu Miami Owner"
node scripts/smoke-post-bootstrap.mjs --expected-project-id daegu-miami-production --academy-id academy_daegumiami --owner-email "<REAL_OWNER_EMAIL>"
```
