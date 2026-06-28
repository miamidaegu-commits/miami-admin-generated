# Production Deploy Notes

## #117 Hosting Blank Incident

After the #117 production deploy, `daegumiami.com` initially served the Hosting shell and assets but rendered a blank page. The production Functions deploy was healthy, and Firestore rules were intentionally not deployed.

Root cause: the first Hosting build was created without `.env.production`, so the Vite production bundle did not include the required `VITE_FIREBASE_*` values. The browser failed during Firebase initialization with the existing missing-env guard.

Recovery: Hosting was rebuilt and redeployed only after temporarily linking a Firebase SDK config-derived `.env.production`. Functions and Firestore rules were not redeployed during the hotfix. The temporary env file and symlink were removed after the deploy.

## Production Hosting Deploy Rule

Use only the guarded production Hosting command:

```sh
npm run deploy:hosting:production
```

Do not deploy production Hosting from a plain `npm run build` output. The guarded command performs:

1. Remove the previous `dist/`.
2. Validate production Firebase env with `scripts/validate-firebase-env.mjs production`.
3. Build with `vite build --mode production`.
4. Verify that the built JS contains the required production Firebase env values and markers.
5. Deploy Hosting only to `miamiacademyschedule`.

The command intentionally deploys only Hosting. It must not be used to deploy Functions, Firestore rules, indexes, or data changes.

## Secret Handling

Never commit `.env.production`, `.env.production.local`, symlinks to env files, service account keys, or generated build artifacts. The env guards print only key presence and yes/no verification results; they must not print API keys, app IDs, auth domain values, or full env file contents.

If an emergency env symlink is needed during an incident, remove it after the deploy and confirm:

```sh
npm run clean:artifacts
git status -sb
```

## Stop Conditions

Stop and do not deploy production Hosting if:

- `.env.production` is missing.
- Any required `VITE_FIREBASE_*` key is missing.
- `VITE_FIREBASE_PROJECT_ID` is not `daegu-miami-production`.
- `dist/assets/*.js` is missing after the build.
- Built JS does not contain the required production Firebase env values.
- Built JS is missing `daegu-miami-production`, `firebaseapp.com`, or `initializeApp` markers.
- The deploy command includes Functions, Firestore rules, indexes, or any resource other than Hosting.
