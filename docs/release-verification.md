# Release Verification

Run these checks before a hosted release or after a release-risk change has landed.

## Commands

Use the full release suite before final release sign-off:

```sh
npm run verify:all
```

`verify:all` runs the browser release suite, the built-output security scan, and safe operations-script checks.

Use the hosted smoke check when you only need to confirm the currently deployed hosted app still opens the critical public/protected routes:

```sh
npm run verify:hosted
```

Use the core local E2E suite when app behavior changed and the hosted smoke was already checked separately:

```sh
npm run verify:core
```

Use the built-output scan after `npm run build:e2e` when you only need to verify that `dist/` does not contain server/admin secrets or local/dev project references:

```sh
npm run verify:dist
```

Use the operations-script checks when runbook scripts changed:

```sh
npm run verify:ops-scripts
```

## Expected Output

The runner prints one section per command, for example:

```text
=== [1/9] E2E build ===
$ npm run build:e2e
```

Successful runs end with a summary like:

```text
PASS release verification (e2e) in 180s.
```

On failure, the runner stops at the first failing command and prints:

```text
FAIL release verification (core) after 45s.
```

## On Failure

Read the first failing error, fix the app, fixture, build-output, or script issue, then rerun the smallest relevant command first. After the targeted failure passes, rerun `npm run verify:all` before release sign-off.

These verification scripts do not deploy, delete data, reset data, export data, or run bootstrap/reset commands. They only run the configured build and Playwright checks, with the normal E2E fixture setup and cleanup already used by those tests.

## Browser Coverage

The core browser suite covers student login invitation, group and private booking flows, admin student history, role-based 오늘의 일정, 오늘의 영상 daily materials, and the public class intro page. The hosted smoke suite separately checks the deployed public and protected routes.

## Hosting Deploy

Hosting deployment is separate from verification. After UI changes are approved, deploy hosting explicitly:

```sh
npm run build:e2e
npx firebase deploy --only hosting --project miami-e2e
```
