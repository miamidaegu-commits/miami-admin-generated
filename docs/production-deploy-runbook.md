# Production Deploy Runbook

Target Firebase project: `daegu-miami-production`
Production domain: `https://daegumiami.com`
Staging/e2e project: `miami-e2e`

This runbook prepares production without deleting data, resetting data, weakening tenant safety, or changing Firestore rules and Cloud Functions business logic.

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
