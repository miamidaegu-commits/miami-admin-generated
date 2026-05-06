import { spawn } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const hostedSteps = [
  {
    name: 'Hosted smoke',
    command: npxCmd,
    args: ['playwright', 'test', 'tests/hosted-smoke.spec.js', '--project=chromium'],
  },
];

const coreSteps = [
  {
    name: 'Student account linking',
    command: npxCmd,
    args: ['playwright', 'test', 'tests/student-account-linking.spec.js', '--project=chromium'],
  },
  {
    name: 'Student group lesson booking',
    command: npxCmd,
    args: ['playwright', 'test', 'tests/student-group-lesson-booking.spec.js', '--project=chromium'],
  },
  {
    name: 'Private lesson slot booking',
    command: npxCmd,
    args: ['playwright', 'test', 'tests/private-lesson-slot-booking.spec.js', '--project=chromium'],
  },
  {
    name: 'Admin student history',
    command: npxCmd,
    args: ['playwright', 'test', 'tests/admin-student-history.spec.js', '--project=chromium'],
  },
  {
    name: 'Today schedule',
    command: npxCmd,
    args: ['playwright', 'test', 'tests/today-schedule.spec.js', '--project=chromium'],
  },
  {
    name: 'Daily materials',
    command: npxCmd,
    args: ['playwright', 'test', 'tests/daily-materials.spec.js', '--project=chromium'],
  },
  {
    name: 'Public class intro',
    command: npxCmd,
    args: ['playwright', 'test', 'tests/public-class-intro.spec.js', '--project=chromium'],
  },
];

const buildStep = {
  name: 'E2E build',
  command: npmCmd,
  args: ['run', 'build:e2e'],
};

const opsScriptSteps = [
  {
    name: 'audit-before-reset syntax',
    command: 'node',
    args: ['--check', 'scripts/audit-before-reset.mjs'],
  },
  {
    name: 'plan-production-reset syntax',
    command: 'node',
    args: ['--check', 'scripts/plan-production-reset.mjs'],
  },
  {
    name: 'bootstrap-live-academy self-test',
    command: 'node',
    args: ['scripts/bootstrap-live-academy.mjs', '--self-test'],
  },
  {
    name: 'smoke-post-bootstrap syntax',
    command: 'node',
    args: ['--check', 'scripts/smoke-post-bootstrap.mjs'],
  },
  {
    name: 'ensure-student-access-summaries syntax',
    command: 'node',
    args: ['--check', 'scripts/ensure-student-access-summaries.mjs'],
  },
  {
    name: 'redact-password-reset-links-from-logs syntax',
    command: 'node',
    args: ['--check', 'scripts/redact-password-reset-links-from-logs.mjs'],
  },
];

const allSteps = [
  {
    name: 'Release E2E verification',
    command: npmCmd,
    args: ['run', 'verify:e2e'],
  },
  {
    name: 'Built output scan',
    command: npmCmd,
    args: ['run', 'verify:dist'],
  },
  {
    name: 'Operations script checks',
    command: npmCmd,
    args: ['run', 'verify:ops-scripts'],
  },
];

const suites = {
  hosted: hostedSteps,
  core: coreSteps,
  e2e: [buildStep, ...hostedSteps, ...coreSteps],
  'ops-scripts': opsScriptSteps,
  all: allSteps,
};

function getSuiteName(argv) {
  const suiteArg = argv.find((arg) => arg.startsWith('--suite='));
  const suiteName = suiteArg ? suiteArg.slice('--suite='.length) : 'e2e';
  if (!Object.hasOwn(suites, suiteName)) {
    throw new Error(`Unknown suite "${suiteName}". Expected one of: ${Object.keys(suites).join(', ')}`);
  }
  return suiteName;
}

function formatCommand(step) {
  return [step.command, ...step.args].join(' ');
}

function runStep(step, index, total) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== [${index + 1}/${total}] ${step.name} ===`);
    console.log(`$ ${formatCommand(step)}`);

    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${step.name} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
    });
  });
}

async function main() {
  const suiteName = getSuiteName(process.argv.slice(2));
  const steps = suites[suiteName];
  const startedAt = Date.now();

  console.log(`Release verification suite: ${suiteName}`);
  console.log('This runner does not deploy, reset data, delete data, or run bootstrap/reset commands.');

  try {
    for (let index = 0; index < steps.length; index += 1) {
      await runStep(steps[index], index, steps.length);
    }
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`\nPASS release verification (${suiteName}) in ${elapsedSeconds}s.`);
  } catch (error) {
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.error(`\nFAIL release verification (${suiteName}) after ${elapsedSeconds}s.`);
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

main();
