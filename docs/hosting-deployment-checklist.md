# Hosting Deployment Checklist

Use this checklist to prepare Firebase Hosting for the `miami-e2e` project. Do not deploy automatically. Deploy only after the operator confirms the project, build mode, hosting config, and intended URL.

## 1. Current Hosting Status

Current `firebase.json` includes Firestore, Cloud Functions, and Firebase Hosting configuration.

The Hosting block is:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

Current `.firebaserc` default project is:

```json
{
  "projects": {
    "default": "miamiacademyschedule"
  }
}
```

Because the default project is not `miami-e2e`, always pass `--project miami-e2e` for hosting deploy commands.

## 2. Build Output Directory

The Vite build output directory is:

```text
dist
```

Firebase Hosting should serve `dist`.

## 3. Firebase Env For miami-e2e

The `miami-e2e` Firebase web config is stored in:

```text
.env.e2e
.env.e2e.local
```

The app only switches to the `miami-e2e` Firebase config when `VITE_FIREBASE_PROJECT_ID=miami-e2e` is present at build time.

Important distinction:

- `npm run build` runs `vite build` in the default mode and currently falls back to the hardcoded `miamiacademyschedule` config in `firebase.js`.
- `npm run build:e2e` runs `node scripts/validate-firebase-env.mjs e2e && vite build --mode e2e`, which validates and loads `.env.e2e` for `miami-e2e`.

For a `miami-e2e` production-like hosted deployment, prefer:

```bash
npm run build:e2e
```

Only use `npm run build` for hosting if the default production env is intentionally configured for the target Firebase project.

## 4. Hosting Config

Hosting config is now present in `firebase.json`:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

This is needed because the app uses client-side routing and should serve `index.html` for deep links.

Do not deploy until this config and the build output have been reviewed.

## 5. Safe Deploy Commands

Requested command shape:

```bash
npm run build
npx firebase deploy --only hosting --project miami-e2e
```

Recommended command shape for `miami-e2e` with the current env setup:

```bash
npm run build:e2e
npx firebase deploy --only hosting --project miami-e2e
```

Use the recommended `build:e2e` command unless the production/default Vite environment has been changed to point at `miami-e2e`.

## 6. Pre-Deploy Checklist

Before deployment:

- Confirm Firebase project is `miami-e2e`.
- Confirm `firebase.json` includes the reviewed `hosting` block shown above.
- Confirm `public` is `dist`.
- Confirm SPA rewrite to `/index.html` exists.
- Confirm `.env.e2e` contains the intended `miami-e2e` web app values.
- Run `npm run build:e2e`.
- Confirm `dist/index.html` and `dist/assets/*` exist.
- Confirm no secrets are committed into build output.
- Confirm Firestore rules and business logic are not being changed as part of hosting deploy.
- Confirm operator has permission to deploy Firebase Hosting.

## 7. Deploy Checklist

Deploy only after pre-deploy checks pass:

```bash
npx firebase deploy --only hosting --project miami-e2e
```

Record:

- Deploying operator.
- Date/time.
- Git revision or working tree snapshot.
- Build command used.
- Firebase project id.
- Hosting URL returned by Firebase CLI.

## 8. Post-Deploy Smoke

After deploy:

- Open the Firebase Hosting URL.
- Confirm login page loads from the hosted URL.
- Owner/admin can sign in.
- Teacher can sign in.
- Student can sign in.
- Dashboard routes survive refresh.
- Student booking routes survive refresh.
- Browser console has no Firebase project mismatch errors.
- Auth domain works for `miami-e2e`.
- Network calls target `miami-e2e`.
- No localhost URLs are required.

## 9. Hosted Smoke Checklist

For live-readiness polish, verify these hosted flows from the Firebase Hosting URL:

- Admin hosted login reaches `/dashboard` and shows the dashboard.
- Student hosted login reaches `/student-booking` and shows `수업 예약`.
- Refreshing `/dashboard` reloads the app without a 404 or redirect loop.
- Refreshing `/student-booking` reloads the app without a 404 or redirect loop.
- Browser console and network requests show no Firebase project mismatch.
- The hosted app does not depend on `localhost` URLs, local Vite assets, or local emulator endpoints.

## 10. Stop-The-Line Criteria

Stop and do not deploy if:

- Hosting config is missing or differs from the reviewed `dist`/SPA rewrite config.
- Build was not run.
- Build output is not `dist`.
- Build was created with the wrong Firebase project env.
- `.firebaserc` default project is used without `--project miami-e2e`.
- Any deploy command includes Firestore rules, indexes, functions, or other resources unintentionally.
- Login works locally but fails from hosted URL.
- Hosted app points at `miamiacademyschedule` when the intended target is `miami-e2e`.
- Any operator is unsure which Firebase project will receive the deploy.

## 11. Rollback / Disable Notes

Firebase Hosting can roll back to a previous release from the Firebase Console or CLI without deleting Firestore data.

Do not reset or delete data to handle a hosting issue. Prefer:

- Roll back Hosting to the previous release.
- Disable the problematic UI path with a reviewed code change.
- Redeploy only Hosting after a clean build.
- Keep Firestore rules, indexes, and Functions out of the hosting-only deploy unless a separate approved change exists.
