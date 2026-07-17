import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {
  ACADEMY_SCOPED_RESET_REGISTRY,
} from "../functions/scripts/academy-scoped-test-data-reset-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.resolve(__dirname, "..", "firestore.rules");
const rules = fs.readFileSync(rulesPath, "utf8");

function functionBody(name) {
  const start = rules.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing Rules helper ${name}`);
  const bodyStart = rules.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < rules.length; index += 1) {
    if (rules[index] === "{") depth += 1;
    if (rules[index] === "}") depth -= 1;
    if (depth === 0) return rules.slice(bodyStart + 1, index);
  }
  assert.fail(`Unclosed Rules helper ${name}`);
}

function allowStatements() {
  return [...rules.matchAll(/allow\s+([^:]+):\s*if\s*([\s\S]*?);/g)]
      .map((match) => ({
        operations: match[1].split(",").map((value) => value.trim()),
        condition: match[2].trim(),
      }));
}

function isExactSentinelFixture(value) {
  const exactKeys = [
    "academyId",
    "active",
    "mode",
    "projectId",
    "schemaVersion",
  ];
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(exactKeys) &&
    typeof value.active === "boolean" &&
    typeof value.schemaVersion === "string" &&
    value.schemaVersion === "academy_reset_write_freeze.v1" &&
    typeof value.mode === "string" &&
    value.mode === "academy_test_data_reset" &&
    typeof value.academyId === "string" &&
    value.academyId === "academy_daegumiami" &&
    typeof value.projectId === "string" &&
    value.projectId === "daegu-miami-production";
}

test("active and inactive sentinels share one exact schema validator", () => {
  const body = functionBody("validTargetResetWriteFreezeSentinel");
  const exact = functionBody("exactTargetResetWriteFreezeSentinel");
  assert.match(
      body,
      /sentinel == exactTargetResetWriteFreezeSentinel\(true\)/,
  );
  assert.match(
      body,
      /sentinel == exactTargetResetWriteFreezeSentinel\(false\)/,
  );
  for (const [key, literal] of [
    ["active", "active"],
    ["schemaVersion", '"academy_reset_write_freeze.v1"'],
    ["mode", '"academy_test_data_reset"'],
    ["academyId", '"academy_daegumiami"'],
    ["projectId", '"daegu-miami-production"'],
  ]) {
    assert.match(exact, new RegExp(`"${key}":\\s*${literal.replace(".", "\\.")}`));
  }
});

test("inactive malformed and partial sentinel fixtures are adversarially pinned", () => {
  const validInactive = {
    active: false,
    schemaVersion: "academy_reset_write_freeze.v1",
    mode: "academy_test_data_reset",
    academyId: "academy_daegumiami",
    projectId: "daegu-miami-production",
  };
  assert.equal(isExactSentinelFixture(validInactive), true);
  assert.equal(isExactSentinelFixture({...validInactive, active: true}), true);

  const malformedInactive = [
    {active: false},
    {...validInactive, unknown: true},
    {...validInactive, active: "false"},
    {...validInactive, schemaVersion: 1},
    {...validInactive, schemaVersion: "academy_reset_write_freeze.v2"},
    {...validInactive, mode: false},
    {...validInactive, mode: "other"},
    {...validInactive, academyId: 1},
    {...validInactive, academyId: "academy_other"},
    {...validInactive, projectId: []},
    {...validInactive, projectId: "other-project"},
    ...Object.keys(validInactive).map((keyToRemove) =>
      Object.fromEntries(
          Object.entries(validInactive).filter(([key]) => key !== keyToRemove),
      )),
  ];
  for (const sentinel of malformedInactive) {
    assert.equal(isExactSentinelFixture(sentinel), false);
  }
});

test("Rules sentinel literals remain pinned to the reset contract", () => {
  for (const literal of [
    '"academy_reset_write_freeze.v1"',
    '"academy_test_data_reset"',
    '"academy_daegumiami"',
    '"daegu-miami-production"',
  ]) {
    assert.equal(rules.includes(literal), true, literal);
  }
});

test("absent and valid inactive sentinels preserve existing writes", () => {
  const body = functionBody(
      "targetAcademyWriteFreezeAllowsClientWrites",
  );
  assert.match(body, /!exists\(academyPath\) \? false/);
  assert.match(
      body,
      /!\("resetWriteFreeze" in academySnapshot\.data\.keys\(\)\) \? true/,
  );
  assert.match(
      body,
      /resetWriteFreeze ==[\s\S]*exactTargetResetWriteFreezeSentinel\(false\)/,
  );
});

test("only a valid inactive present sentinel is permissive", () => {
  const body = functionBody(
      "targetAcademyWriteFreezeAllowsClientWrites",
  );
  const presentBranch = body.slice(body.indexOf("resetWriteFreeze =="));
  assert.doesNotMatch(presentBranch, /\|\|/);
  assert.doesNotMatch(presentBranch, /\?\s*true/);
  assert.match(
      presentBranch,
      /resetWriteFreeze ==[\s\S]*exactTargetResetWriteFreezeSentinel\(false\)/,
  );
});

test("write-freeze target classification uses exact academyId fields only", () => {
  assert.match(
      functionBody("sameAcademyOnCreate"),
      /resetWriteFreezeAllowsAcademyWrite\(request\.resource\.data\.academyId\)/,
  );
  assert.match(
      functionBody("sameAcademyOnUpdate"),
      /resetWriteFreezeAllowsAcademyWrite\(resource\.data\.academyId\)/,
  );
  assert.match(
      functionBody("sameAcademyOnDelete"),
      /resetWriteFreezeAllowsAcademyWrite\(resource\.data\.academyId\)/,
  );
  assert.match(
      functionBody("resetWriteFreezeAllowsAcademyDocumentWrite"),
      /resetWriteFreezeAllowsAcademyWrite\(academyId\)/,
  );
  assert.match(
      functionBody("validTeacherPermissionUpdate"),
      /resetWriteFreezeAllowsAcademyWrite\(resource\.data\.academyId\)/,
  );
  assert.match(
      functionBody("resetWriteFreezeAllowsGlobalWrite"),
      /targetAcademyWriteFreezeAllowsClientWrites\(\)/,
  );
  assert.match(
      functionBody("resetWriteFreezeAllowsAcademyWrite"),
      /academyId != "academy_daegumiami"/,
  );
  for (const helper of [
    "sameAcademyOnCompositeCreate",
    "sameAcademyOnCompositeUpdate",
    "sameAcademyOnCompositeDelete",
  ]) {
    assert.match(rules, new RegExp(`function ${helper}\\(\\)`));
    assert.doesNotMatch(functionBody(helper), /documentId|membershipId/);
  }
  assert.doesNotMatch(rules, /function isTargetAcademyCompositeDocumentId/);
  assert.doesNotMatch(rules, /\^academy_daegumiami/);
  assert.match(
      rules,
      /allow update: if validTeacherPermissionUpdate\(\);/,
  );
  assert.doesNotMatch(functionBody("validTeacherPermissionUpdate"), /membershipId/);
});

test("all 29 reset registry surfaces have explicit Rules matches", () => {
  assert.equal(ACADEMY_SCOPED_RESET_REGISTRY.length, 29);
  const matchedCollections = new Set(
      [...rules.matchAll(/match \/([A-Za-z][A-Za-z0-9]*)\/\{[^}]+\}/g)]
          .map((match) => match[1]),
  );
  const missing = ACADEMY_SCOPED_RESET_REGISTRY
      .map(({collectionName}) => collectionName)
      .filter((collectionName) => !matchedCollections.has(collectionName));
  assert.deepEqual(missing, []);
});

test("every potentially permissive client write routes through a gate alias", () => {
  const gateAliases = [
    "resetWriteFreezeAllowsGlobalWrite(",
    "resetWriteFreezeAllowsAcademyDocumentWrite(",
    "validTeacherPermissionUpdate(",
    "sameAcademyOnCreate(",
    "sameAcademyOnUpdate(",
    "sameAcademyOnDelete(",
    "sameAcademyOnCompositeCreate(",
    "sameAcademyOnCompositeUpdate(",
    "sameAcademyOnCompositeDelete(",
  ];
  const writes = allowStatements().filter(({operations}) =>
    operations.some((operation) =>
      ["write", "create", "update", "delete"].includes(operation)));
  const unguarded = writes.filter(({condition}) =>
    !condition.startsWith("false") &&
    !gateAliases.some((alias) => condition.includes(alias)));
  assert.deepEqual(unguarded, []);
});

test("read policy expressions do not invoke the write-freeze gate", () => {
  const reads = allowStatements().filter(({operations}) =>
    operations.some((operation) =>
      ["read", "get", "list"].includes(operation)));
  for (const {condition} of reads) {
    assert.doesNotMatch(condition, /resetWriteFreeze|sameAcademyOnDelete/);
  }
});

test("preserved and global surfaces are immutable during maintenance", () => {
  const membershipUpdate = rules.match(
      /match \/academyMemberships\/\{membershipId\}[\s\S]*?allow update:[^;]+;/,
  )?.[0] || "";
  assert.match(membershipUpdate, /validTeacherPermissionUpdate\(\)/);
  assert.match(
      functionBody("validTeacherPermissionUpdate"),
      /resetWriteFreezeAllowsAcademyWrite\(resource\.data\.academyId\)/,
  );

  for (const collection of [
    "fixedPrivateRenewalBatches",
    "fixedPrivateAssignmentBatches",
    "fixedPrivateRescheduleBatches",
    "fixedPrivateLessonOutcomeActionBatches",
    "privateLessonStatusActionBatches",
    "privateLessonOutcomeActionBatches",
    "accountProvisioningLogs",
  ]) {
    const start = rules.indexOf(`match /${collection}/{`);
    const block = start === -1 ? "" : rules.slice(start, start + 160);
    assert.match(block, /allow read, write: if false;/, collection);
  }
});

test("Rules and tests explicitly document the Admin SDK boundary", () => {
  assert.match(rules, /Security Rules do not govern trusted Admin SDK/);
  assert.match(rules, /trusted Admin SDK writes remain outside Rules scope/);
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
});
