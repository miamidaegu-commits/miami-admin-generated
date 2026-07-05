import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
];

const EXPECTED_PROJECT_ID = 'daegu-miami-production';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env.production');
const distAssetsDir = path.join(repoRoot, 'dist', 'assets');

function parseEnvFile(filePath) {
  const data = {};
  const text = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;

    const [rawKey, ...valueParts] = line.split('=');
    const key = rawKey.trim();
    const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    data[key] = value;
  }

  return data;
}

function listJsAssets(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(dirPath, entry.name))
    .sort();
}

function readBundle(files) {
  return files.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
}

function printCheck(name, ok) {
  console.log(`${name}: ${ok ? 'yes' : 'no'}`);
}

function main() {
  if (!fs.existsSync(envPath)) {
    console.error('STOP: .env.production is required for production dist verification.');
    process.exit(1);
  }

  const env = parseEnvFile(envPath);
  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !String(env[key] || '').trim());
  const projectIdOk = env.VITE_FIREBASE_PROJECT_ID === EXPECTED_PROJECT_ID;

  console.log(`required_key_count: ${REQUIRED_ENV_KEYS.length}`);
  console.log(`missing_key_count: ${missingKeys.length}`);
  for (const key of REQUIRED_ENV_KEYS) {
    printCheck(`required_${key}`, Boolean(String(env[key] || '').trim()));
  }
  console.log(`project_id_ok: ${projectIdOk ? 'true' : 'false'}`);

  if (missingKeys.length > 0) {
    console.error(`STOP: missing required production env keys: ${missingKeys.join(', ')}`);
    process.exit(1);
  }

  if (!projectIdOk) {
    console.error(`STOP: VITE_FIREBASE_PROJECT_ID must be ${EXPECTED_PROJECT_ID}.`);
    process.exit(1);
  }

  const jsAssets = listJsAssets(distAssetsDir);
  console.log(`js_asset_count: ${jsAssets.length}`);

  if (jsAssets.length === 0) {
    console.error('STOP: no JS assets found in dist/assets.');
    process.exit(1);
  }

  const bundle = readBundle(jsAssets);
  const missingEmbeddedValues = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const embedded = bundle.includes(env[key]);
    printCheck(`embedded_${key}`, embedded);
    if (!embedded) missingEmbeddedValues.push(key);
  }

  const projectMarkerOk = bundle.includes(EXPECTED_PROJECT_ID);
  const firebaseAppMarkerOk = bundle.includes('firebaseapp.com');
  const initializeAppMarkerOk = bundle.includes('initializeApp');

  printCheck('built_marker_daegu_miami_production', projectMarkerOk);
  printCheck('built_marker_firebaseapp_com', firebaseAppMarkerOk);
  printCheck('built_marker_initializeApp', initializeAppMarkerOk);

  const failed = [
    ...missingEmbeddedValues.map((key) => `embedded_${key}`),
    projectMarkerOk ? null : 'built_marker_daegu_miami_production',
    firebaseAppMarkerOk ? null : 'built_marker_firebaseapp_com',
    initializeAppMarkerOk ? null : 'built_marker_initializeApp',
  ].filter(Boolean);

  if (failed.length > 0) {
    console.error(`STOP: production dist env verification failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

main();
