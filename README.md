# Firebase Admin Dashboard

A clean React + Vite admin dashboard with Firebase Auth and Firestore role-based access.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure Firebase

Edit `src/lib/firebase.js` and replace the placeholder values with your project credentials:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
}
```

Find these in **Firebase Console → Project Settings → Your Apps → SDK setup**.

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
