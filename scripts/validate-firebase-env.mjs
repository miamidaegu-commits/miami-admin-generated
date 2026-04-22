import { loadEnv } from 'vite'

const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]
const E2E_FIREBASE_PROJECT_ID = 'miami-e2e'

const requestedMode = process.argv[2] || 'development'
const loadedEnv = loadEnv(requestedMode, process.cwd(), '')

for (const [key, value] of Object.entries(loadedEnv)) {
  if (process.env[key] == null) {
    process.env[key] = value
  }
}

const missingKeys = FIREBASE_ENV_KEYS.filter((key) => !String(process.env[key] || '').trim())

if (missingKeys.length > 0) {
  console.error(
    `Missing Firebase environment variables for ${requestedMode} mode: ${missingKeys.join(', ')}`
  )
  process.exit(1)
}

if (
  requestedMode === 'e2e' &&
  process.env.VITE_FIREBASE_PROJECT_ID !== E2E_FIREBASE_PROJECT_ID
) {
  console.error(
    `E2E mode requires VITE_FIREBASE_PROJECT_ID=${E2E_FIREBASE_PROJECT_ID}, received ${String(process.env.VITE_FIREBASE_PROJECT_ID || '')}.`
  )
  process.exit(1)
}
