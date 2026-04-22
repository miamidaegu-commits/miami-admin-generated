# Firebase Admin Dashboard

A clean React + Vite admin dashboard with Firebase Auth and Firestore role-based access.

## Setup

## Node Version

Recommended Node version for this project: `v20.20.2`

If you use `nvm`:

```bash
nvm use
```

Before running Playwright, confirm the active Node version:

```bash
node -v
```

It should print:

```bash
v20.20.2
```

### 1. Install dependencies
```bash
npm install
```

### 2. Configure Firebase env

The app now reads Firebase web config from environment variables.

Create local env files from the examples:

```bash
cp .env.example .env.local
cp .env.e2e.example .env.e2e.local
```

Production app env keys:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

E2E app/test env keys use the same names, but the values should come from the separate E2E Firebase project:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Find the values in **Firebase Console → Project Settings → Your Apps → SDK setup**.

### 3. Enable Firebase Auth

In the Firebase Console:
- Go to **Authentication → Sign-in method**
- Enable **Email/Password**

### 4. Set up Firestore

Create a document for each admin user at `users/{uid}`:

```json
{
  "role": "admin"
}
```

> **Note**: `{uid}` is the user's Firebase Auth UID (found in Authentication → Users).

### 5. Firestore Security Rules (recommended)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth.uid == uid;
    }
  }
}
```

### 6. Run the app
```bash
npm run dev
```

`npm run dev` uses your production/local app env such as `.env.local`.

### 7. Run Playwright
```bash
source "$HOME/.nvm/nvm.sh"
nvm use
node -v
npm run test:e2e:chromium
```

`npm run test:e2e:chromium` starts the app with `vite --mode e2e`, so local E2E runs use `.env.e2e.local` or `.env.e2e`.
`npm run dev:e2e` and `npm run build:e2e` also fail fast unless all six `VITE_FIREBASE_*` values are present and `VITE_FIREBASE_PROJECT_ID=miami-e2e`.

Optional local commands:

```bash
npm run dev:e2e
npm run build:e2e
```

## Firebase Environment Split

- Production app: `npm run dev` and `npm run build` read `VITE_FIREBASE_*` from your normal app env files or shell environment.
- Local E2E: `npm run dev:e2e`, `npm run build:e2e`, and `npm run test:e2e:chromium` read `VITE_FIREBASE_*` from `.env.e2e` or `.env.e2e.local`.
- GitHub Actions E2E: `.github/workflows/e2e.yml` maps E2E-only repository secrets into `VITE_FIREBASE_*`, then runs `npm run build:e2e` and `npm run test:e2e:chromium` against the E2E Firebase project.

## GitHub Actions Secrets

Configure these repository secrets for the E2E Firebase project:

```bash
E2E_FIREBASE_API_KEY
E2E_FIREBASE_AUTH_DOMAIN
E2E_FIREBASE_PROJECT_ID
E2E_FIREBASE_STORAGE_BUCKET
E2E_FIREBASE_MESSAGING_SENDER_ID
E2E_FIREBASE_APP_ID
```

## Project Structure

```
src/
├── lib/
│   └── firebase.js         # Firebase init (Auth + Firestore)
├── context/
│   └── AuthContext.jsx     # Auth state + Firestore role loading
├── components/
│   └── ProtectedRoute.jsx  # Redirects non-admin users
├── pages/
│   ├── Login.jsx           # Email/password sign-in
│   ├── Dashboard.jsx       # Admin-only dashboard
│   └── Unauthorized.jsx    # Shown to non-admin users
├── App.jsx                 # Routes
└── main.jsx                # Entry point
```

## Auth Flow

1. User signs in with email + password (Firebase Auth)
2. `AuthContext` listens for auth state changes
3. On sign-in, it reads `users/{uid}` from Firestore to get the `role`
4. `ProtectedRoute` checks `role === 'admin'`
   - Not signed in → `/login`
   - Signed in, not admin → `/unauthorized`
   - Admin → renders `Dashboard`
