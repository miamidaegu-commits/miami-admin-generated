import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const SERVICE_ACCOUNT_PATH = path.join(repoRoot, 'serviceAccountKey.json');
const TARGET_PROJECT_ID = 'miami-e2e';
const COLLECTION_NAME = 'accountProvisioningLogs';
const PAGE_SIZE = 500;
const REDACTABLE_FIELDS = ['passwordResetLink', 'resetLink'];

function parseArgs(argv) {
  const write = argv.includes('--write');
  const unknown = argv.filter((arg) => arg !== '--write');
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(', ')}`);
  }
  return { write };
}

function initializeAdmin() {
  assert.equal(
    fs.existsSync(SERVICE_ACCOUNT_PATH),
    true,
    'serviceAccountKey.json is required for log redaction'
  );

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  assert.equal(
    serviceAccount.project_id,
    TARGET_PROJECT_ID,
    `Expected ${TARGET_PROJECT_ID} service account, received ${serviceAccount.project_id}`
  );

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  return admin.firestore();
}

function getRedactableFields(data) {
  return REDACTABLE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
}

async function commitBatchIfNeeded(batch, count) {
  if (count > 0) await batch.commit();
}

async function scanAndMaybeRedact({ db, write }) {
  let scannedCount = 0;
  let matchedCount = 0;
  let redactedCount = 0;
  const matchedDocIds = [];
  const documentId = admin.firestore.FieldPath.documentId();
  let lastDoc = null;
  let batch = db.batch();
  let batchCount = 0;

  while (true) {
    let q = db.collection(COLLECTION_NAME).orderBy(documentId).limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      scannedCount += 1;
      const data = docSnap.data() || {};
      const fields = getRedactableFields(data);
      if (fields.length === 0) continue;

      matchedCount += 1;
      matchedDocIds.push(docSnap.id);

      if (write) {
        const updatePayload = Object.fromEntries(
          fields.map((field) => [field, admin.firestore.FieldValue.delete()])
        );
        batch.update(docSnap.ref, updatePayload);
        batchCount += 1;
        redactedCount += 1;

        if (batchCount >= 450) {
          await commitBatchIfNeeded(batch, batchCount);
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  if (write) await commitBatchIfNeeded(batch, batchCount);

  return {
    scannedCount,
    matchedCount,
    redactedCount,
    mode: write ? 'write' : 'dry-run',
    matchedDocIds,
  };
}

async function main() {
  const { write } = parseArgs(process.argv.slice(2));
  const db = initializeAdmin();
  const summary = await scanAndMaybeRedact({ db, write });
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
