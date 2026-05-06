import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

function getFirebaseConfigFromEnv(env) {
  const missingKeys = FIREBASE_ENV_KEYS.filter((key) => !String(env[key] || '').trim())

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing Firebase environment variables: ${missingKeys.join(', ')}`
    )
  }

  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  }
}

if (
  import.meta.env.MODE === 'e2e' &&
  import.meta.env.VITE_FIREBASE_PROJECT_ID !== 'miami-e2e'
) {
  throw new Error('E2E mode requires VITE_FIREBASE_PROJECT_ID=miami-e2e.')
}

const activeFirebaseConfig = getFirebaseConfigFromEnv(import.meta.env)

const app = getApps().length > 0 ? getApp() : initializeApp(activeFirebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, 'us-central1')
