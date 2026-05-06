import { loadEnv } from 'vite'

const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]
const PUBLIC_ENV_KEYS = [
  'VITE_PUBLIC_APP_URL',
]
const E2E_FIREBASE_PROJECT_ID = 'miami-e2e'
const PRODUCTION_FIREBASE_PROJECT_ID = 'daegu-miami-production'
const REQUIRED_PROJECT_BY_MODE = {
  e2e: E2E_FIREBASE_PROJECT_ID,
  production: PRODUCTION_FIREBASE_PROJECT_ID,
}

const requestedMode = process.argv[2] || 'development'
const loadedEnv = loadEnv(requestedMode, process.cwd(), '')

for (const [key, value] of Object.entries(loadedEnv)) {
  if (process.env[key] == null) {
    process.env[key] = value
  }
}

const requiredKeys = requestedMode === 'e2e' || requestedMode === 'production'
  ? [...FIREBASE_ENV_KEYS, ...PUBLIC_ENV_KEYS]
  : FIREBASE_ENV_KEYS
const missingKeys = requiredKeys.filter((key) => !String(process.env[key] || '').trim())

if (missingKeys.length > 0) {
  console.error(
    `Missing Firebase environment variables for ${requestedMode} mode: ${missingKeys.join(', ')}`
  )
  process.exit(1)
}

const requiredProjectId = REQUIRED_PROJECT_BY_MODE[requestedMode]

if (requiredProjectId && process.env.VITE_FIREBASE_PROJECT_ID !== requiredProjectId) {
  console.error(
    `${requestedMode} mode requires VITE_FIREBASE_PROJECT_ID=${requiredProjectId}, received ${String(process.env.VITE_FIREBASE_PROJECT_ID || '')}.`
  )
  process.exit(1)
}
