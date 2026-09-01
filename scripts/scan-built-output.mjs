import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

const forbiddenPatterns = [
  { name: 'serviceAccountKey', pattern: /serviceAccountKey/g },
  { name: 'firebase-admin', pattern: /firebase-admin/g },
  { name: 'private_key', pattern: /private_key/g },
  { name: 'BEGIN PRIVATE KEY', pattern: /BEGIN PRIVATE KEY/g },
  { name: 'client_email', pattern: /client_email/g },
  { name: 'miamiacademyschedule', pattern: /miamiacademyschedule/g },
  { name: 'daegu-miami-production', pattern: /daegu-miami-production/g },
  { name: 'productionHostingUrl', pattern: /https:\/\/daegumiami\.com/g },
  {
    name: 'productionCloudFunctionsEndpoint',
    pattern: /daegu-miami-production\.cloudfunctions\.net/g,
  },
  {
    name: 'productionRunEndpoint',
    pattern: /daegu-miami-production[^"'`\s]*\.run\.app/g,
  },
  { name: 'emulatorProjectId', pattern: /demo-miami-e2e/g },
  { name: 'firestoreEmulatorHost', pattern: /FIRESTORE_EMULATOR_HOST/g },
  {
    name: 'emulatorEndpoint',
    pattern: /https?:\/\/(?:localhost|127\.0\.0\.1):[0-9]+/g,
  },
  { name: 'localhost', pattern: /localhost/g },
  { name: '127.0.0.1', pattern: /127\.0\.0\.1/g },
];

const allowedPatterns = [
  { name: 'miami-e2e', pattern: /miami-e2e/g },
];

const requiredPatterns = [
  { name: 'devProjectId', pattern: /miami-e2e/g },
  {
    name: 'devAppId',
    pattern: /1:912159195659:web:f3812d54768f7d35a4fd0e/g,
  },
  {
    name: 'devPublicAppUrl',
    pattern: /https:\/\/miami-e2e\.web\.app/g,
  },
];

const allowedFindingRules = [
  {
    token: 'localhost',
    reason: 'Firebase Auth SDK embeds http://localhost as an OAuth popup fallback; app code still must not add local endpoints.',
    isAllowed({ content, matchedText }) {
      return matchedText === 'localhost' && content.includes('@firebase/auth');
    },
  },
];

const textFileExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
]);

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    if (!entry.isFile()) return [];
    return [fullPath];
  });
}

function isTextFile(filePath) {
  return textFileExtensions.has(path.extname(filePath).toLowerCase());
}

function countMatches(content, pattern) {
  pattern.lastIndex = 0;
  return Array.from(content.matchAll(pattern)).length;
}

function isAllowedFinding({ token, content, matchedText }) {
  return allowedFindingRules.find((rule) => (
    rule.token === token && rule.isAllowed({ content, matchedText })
  )) || null;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(repoRoot, filePath);
  const findings = [];
  const allowedFindings = [];

  for (const { name, pattern } of forbiddenPatterns) {
    pattern.lastIndex = 0;
    const matches = Array.from(content.matchAll(pattern));
    if (matches.length === 0) continue;

    const allowedMatches = matches.filter((match) => (
      isAllowedFinding({
        token: name,
        content,
        matchedText: match[0],
      })
    ));
    const blockedCount = matches.length - allowedMatches.length;

    if (blockedCount > 0) {
      findings.push({
        file: relativePath,
        token: name,
        count: blockedCount,
      });
    }
    if (allowedMatches.length > 0) {
      const rule = isAllowedFinding({
        token: name,
        content,
        matchedText: allowedMatches[0][0],
      });
      allowedFindings.push({
        file: relativePath,
        token: name,
        count: allowedMatches.length,
        reason: rule?.reason || 'allowed known-safe dependency token',
      });
    }
  }

  return {
    findings,
    allowedFindings,
  };
}

function scanFiles(files) {
  const results = files.map(scanFile);
  return {
    findings: results.flatMap((result) => result.findings),
    allowedFindings: results.flatMap((result) => result.allowedFindings),
  };
}

function scanAllowedTokens(files) {
  const counts = Object.fromEntries(allowedPatterns.map(({ name }) => [name, 0]));
  for (const file of files) {
    if (!isTextFile(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const { name, pattern } of allowedPatterns) {
      counts[name] += countMatches(content, pattern);
    }
  }
  return counts;
}

function scanRequiredTokens(files) {
  const counts = Object.fromEntries(requiredPatterns.map(({ name }) => [name, 0]));
  for (const file of files) {
    if (!isTextFile(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const { name, pattern } of requiredPatterns) {
      counts[name] += countMatches(content, pattern);
    }
  }
  return counts;
}

function main() {
  if (!fs.existsSync(distDir)) {
    throw new Error('Missing dist/. Run npm run build:e2e before scanning built output.');
  }

  const files = listFiles(distDir);
  const scannedFiles = files.filter(isTextFile);
  const { findings, allowedFindings } = scanFiles(scannedFiles);
  const requiredTokenCounts = scanRequiredTokens(scannedFiles);
  const missingRequiredTokens = Object.entries(requiredTokenCounts)
    .filter(([, count]) => count === 0)
    .map(([name]) => name);
  const summary = {
    ok: findings.length === 0 && missingRequiredTokens.length === 0,
    distDir: path.relative(repoRoot, distDir),
    scannedFileCount: scannedFiles.length,
    skippedFileCount: files.length - scannedFiles.length,
    allowedTokenCounts: scanAllowedTokens(scannedFiles),
    requiredTokenCounts,
    missingRequiredTokens,
    forbiddenTokens: forbiddenPatterns.map(({ name }) => name),
    allowedFindings,
    findings,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main();
