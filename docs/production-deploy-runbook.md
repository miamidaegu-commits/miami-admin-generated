# Production Deploy Runbook

Target Firebase project: `daegu-miami-production`
Production domain: `https://daegumiami.com`
Staging/e2e project: `miami-e2e`

This runbook prepares production without deleting data, resetting data, weakening tenant safety, or changing Firestore rules and Cloud Functions business logic.

## Same-project writer runtime and Dev write guard

The reviewed local toolchain is Firebase CLI `15.13.0` with
`firebase-functions` `7.2.3`. For Gen2 endpoint discovery, the exact source
option `academy-private-writer-runtime@` remains a short-form service-account
value until the CLI combines it with the selected endpoint project. It resolves
to `academy-private-writer-runtime@daegu-miami-production.iam.gserviceaccount.com`
for Production and
`academy-private-writer-runtime@miami-e2e.iam.gserviceaccount.com` for Dev.
Source must not embed either full writer email.

The observed current Dev and Production writer identities both use the
platform role `roles/datastore.user`. This observed-state parity is not the
Production reset/freeze target state: `academyPrivateWriterRuntimeV1` remains
the exact custom-role target required by `academy_private_runtime_iam.v9`.
Current platform-role evidence must not be substituted for that target-state
receipt or used to weaken its validator.

Before a Dev deployment, independently confirm that the exact
`academy-private-writer-runtime@miami-e2e.iam.gserviceaccount.com` identity is
enabled, has `roles/datastore.user`, and has no user-managed key, and that the
deployer has `roles/iam.serviceAccountUser` for that identity. The only approved
future Dev target set for this alignment is:

```sh
firebase deploy --only functions:createFixedPrivateLessonAssignment,functions:commitFixedPrivateLessonOutcomeAction --project miami-e2e
```

This command is scope documentation, not deployment authorization.

## Same-project Preview runtime gate

The Gen2 Preview source uses the exact same-project short form
`academy-private-preview-rt@`. The deployment tooling expands that value only
to the project-local Service Account in the selected deployment project; active
runtime source must not embed a full Preview Service Account email.

For Dev `miami-e2e`, the prerequisite is prepared: the exact
`academy-private-preview-rt@miami-e2e.iam.gserviceaccount.com` identity is
enabled, has `roles/datastore.viewer`, and has zero user-managed keys. The
deployer must have `roles/iam.serviceAccountUser` (ActAs) on that identity.
No key, environment variable, or secret-based Service Account credential is
used.

The Production Preview Function and
`academy-private-preview-rt@daegu-miami-production.iam.gserviceaccount.com`
Service Account are currently absent. Their setup is a separate
future deployment gate. Before any Production Preview deployment, require that
exact identity to be enabled, grant the v9 target-state
custom role `academyBackendReadOnly`, grant the deployer
`roles/iam.serviceAccountUser` (ActAs), and verify zero user-managed keys. The
Dev `roles/datastore.viewer` prerequisite is observed Dev state only and must
not replace, merge with, or weaken the Production custom-role target.

Production reset and write operations remain prohibited by default. This
Preview runtime alignment does not authorize deployment, reset, or write
commands.

## Academy private Functions IAM gate

The Academy private Preview → Assignment → Outcome deployment contract is not
authorized by the commands below. Its local v9 contract requires exact Runtime
IAM state receipts, resource-scoped Build bindings, the nine-permission Deploy
profile, immutable release/source/selector/baseline digests, exact human
principals, and an active RFC3339 UTC JIT window of at most two hours.

The versioned legacy-IAM migration authority treats only the exact preflight
Owner, default-Service-Account Editor, Firebase Admin SDK TokenCreator, and
legacy Cloud Build `roles/cloudbuild.builds.builder` bindings as migration
evidence. The Build Builder binding has only the exact Compute default and
`884850632328@cloudbuild.gserviceaccount.com` members. These broad roles never
prove least privilege for an Academy identity or authorize the Observer
credential. The Owner binding is allowed only through
`POST_PROVISIONING_PRE_DEPLOY` and must be absent before public-invoker
publication. The three deferred bindings must remain byte-exact and carry the
separate decommission-plan version/digest until their independent dependency
reviews complete.

The existing Build baseline is many-to-one: each of the 32 Gen2 Functions must
reference one Build, while the exact Function-derived set may contain 14 shared
Builds. That set must equal the raw successful Build set; every Build must match
its id/name/project/region, the fully-qualified Compute default service-account
resource, `CLOUD_LOGGING_ONLY`, and no logs bucket. The future three Academy
Functions must instead use the fully-qualified dedicated
`academy-functions-build` resource. Bare emails, IAM-member prefixes, and
implicit normalization are rejected in raw Build records.

Artifact Repository IAM adjudication requires the versioned sealed evidence
bundle: exact collection-plan command authority, status/stderr/raw-policy bytes,
and exact pre-adjudication manifest path/length/SHA-256 parity. A standalone
synthetic success object is `INPUT_REQUIRED`; only exact sealed successful
etag-only evidence normalizes to empty bindings and version 1. Project IAM is
authoritative for exact reviewed Service Agent pairs; `iam.serviceAccounts.get`
denial on optional describe metadata is non-blocking. Raw evidence and
result-package digests remain separate, and prior `result.json` verdicts are
never inputs.

The exact phase order is `PRE_PROVISIONING`,
`POST_PROVISIONING_PRE_DEPLOY`,
`POST_PRIVATE_DEPLOY_PRE_PUBLICATION`,
`POST_PUBLICATION_PRE_CLEANUP`, and `FINAL_STEADY_STATE`. Pre-provisioning
requires all four Academy Service Accounts and four custom roles to be absent.
All later phases require the exact active 4+4 resources, exact permissions, no
unexpected `academy-` resources, and zero user-managed keys. Unknown
same-project service agents are `INPUT_REQUIRED`; no
`service-${PROJECT_NUMBER}@*` wildcard is approved.

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
an explicit operator mode and receipt-supplied principals. The default is
fail-closed when the mode is missing. `THREE_PERSON_SEPARATION` requires three
distinct exact `user:<email>` principals and retains the two-hour maximum JIT
window. `SINGLE_OPERATOR_JIT_V1` alone permits the exact repeated tuple
`user:miamidaegu@gmail.com`, requires an exact active JIT window of at most 60
minutes, and does not infer or normalize the user.

Active `SINGLE_OPERATOR_JIT_V1` issuance additionally requires
`academy_single_operator_fresh_preflight_receipt.v1`. The issuance process
generates a 256-bit nonce itself, invokes the approved read-only collector with
that nonce, validates exact canonical receipt bytes and the source/evidence/
manifest/tool/current-state projection, and only then fixes `jitStartsAt`.
The nonce is single-use. A caller-selected nonce, old standalone receipt path,
reconstructed invocation, finding, input requirement, Production data access,
mutation, or changed 32-Function/14-Build PRE_PROVISIONING baseline rejects
issuance. There is no time-based freshness TTL and no existing READY package is
freshness authority by itself.

The collector scope is the minimum projection needed to reprove the current
baseline, not an automatic replay of every historical raw-evidence command. It
must bind the exact active account/project and absent impersonation, absent four
Academy Service Accounts and four Custom Roles, exact four-record legacy IAM
baseline, zero unexpected Academy-prefixed resources, exact 32 Gen2 Functions
with the target three absent, the exact 14-Build and Function→Run→Build
projection digests, zero user-managed keys, exact Artifact metadata/IAM
digests, and the exact 21-record Organization Policy digest. Before JIT start,
the same process must copy the canonical receipt to the secure audit artifact.
The contract accepts in-memory Buffer transport only, so no standalone
temporary freshness file exists to retain or replay. Mutation commands remain
unpublished.

Fresh-preflight contract `academy_single_operator_fresh_preflight_contract.v2`
and Runtime IAM contract `academy_private_runtime_iam.v9` export no Production
helper that can mint authorization from a caller clock, raw projection, or
synthetic receipt. Production orchestration uses only the reviewed-source-fixed
collector/config and its internal clock. Pure config or projection assessments
are data only and are rejected by every downstream authorization API.

Runtime authorization is a linear one-shot chain held in a module-private
`WeakMap`: the fresh module finalizes the canonical
`freshPreflightSameInvocationValidated` state into an opaque capability. The
Production orchestrator consumes that exact capability before validating the
approval template and creates the initial private-validation capability only on
success. Private validation then creates a new publication capability only on
success; publication creates a completion capability only on success;
completion consumes the final capability and creates no successor. Consumption
occurs before validation, so failures cannot be retried with the same object. Reuse,
out-of-order calls, stage skipping, cross-invocation lineage, cloning,
serialization, reconstruction, and raw receipt/approval/assessment inputs all
reject. Canonical receipts remain audit evidence, never authorization
capabilities.

Single-operator approval binds the mode authority to contract base release
`d93ea87b68fa2fb8b9623f418e9a1bf2a3ac1297`. It also requires the exact
13-step order, rollback manifest, `0700`/`0600` secure audit artifact, and
temporary-access removal plan. A separate Production approval reference digest
must be present before local mutation-command publication. Private validation
completion and invoker
publication use separate digest-bound receipts. Public invoker eligibility
remains false until all three new private Functions pass source, permission,
key-count, and final 35/35 validation; publication confirmation must be later
than private validation and remain inside JIT. TokenCreator, actAs, and Deploy
bindings must then be removed and a final permission/key/inventory receipt
recorded inside the same JIT window. The final receipt also binds the canonical
project/Service-Account/bucket/repository/temporary/legacy/reviewed-managed/key/
Run-invoker record sets and recomputed digests. Rollback may restore only an
exact original-baseline subset; automatic Owner restoration after publication
is forbidden and a separate break-glass approval SHA is mandatory.

Both modes still require the exact four same-project service-account identities,
zero user-managed keys, explicit selection of the dedicated Build service
account, the complete permission audit, source binding, and compensating
controls.
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
