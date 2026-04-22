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

const firebaseConfig = {
  apiKey: 'AIzaSyDgF4BT9KnyRpApMY23ScZgbBMSmu-ExuU',
  authDomain: 'miamiacademyschedule.firebaseapp.com',
  projectId: 'miamiacademyschedule',
  storageBucket: 'miamiacademyschedule.firebasestorage.app',
  messagingSenderId: '1086077006833',
  appId: '1:1086077006833:web:344e89ad2f30b5c0b44a50',
}

const isE2ETestFirebase =
  import.meta.env.VITE_FIREBASE_PROJECT_ID === 'miami-e2e'

const e2eFirebaseConfig = isE2ETestFirebase
  ? getFirebaseConfigFromEnv(import.meta.env)
  : null

const activeFirebaseConfig = e2eFirebaseConfig
  ? e2eFirebaseConfig
  : firebaseConfig

const app = getApps().length > 0 ? getApp() : initializeApp(activeFirebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, 'us-central1')
