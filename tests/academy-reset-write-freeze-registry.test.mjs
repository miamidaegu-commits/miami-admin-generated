import assert from "node:assert/strict";
import test from "node:test";
import {
  ACADEMY_RESET_WRITE_SURFACE_REGISTRY,
  EXPECTED_WRITE_SOURCE_COUNT,
  EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST,
  EXPECTED_WRITE_SURFACE_COUNT,
  EXPECTED_WRITE_SURFACE_IDENTITY_DIGEST,
  EXPECTED_WRITE_SURFACE_IDENTITIES,
  RESET_COLLECTIONS,
  WRITE_SOURCE_SHA256_ALLOWLIST,
  WRITE_SURFACE_COUNTS,
  WRITE_SURFACE_REGISTRY_VERSION,
  assertWriteSourceIdentityAllowlist,
  assertWriteSurfaceRegistry,
  writeSourceIdentityDigest,
  writeSurfaceIdentity,
  writeSurfaceIdentityDigest,
} from "../functions/scripts/academy-reset-write-surface-registry.mjs";

test("registry pins 29 reset collections and exact writer category counts", () => {
  assert.equal(
      WRITE_SURFACE_REGISTRY_VERSION,
      "academy_reset_write_surface.v2",
  );
  assert.equal(RESET_COLLECTIONS.length, 29);
  assert.equal(new Set(RESET_COLLECTIONS).size, 29);
  assert.equal(WRITE_SURFACE_COUNTS.writerCount, 60);
  assert.equal(EXPECTED_WRITE_SURFACE_COUNT, 60);
  assert.equal(EXPECTED_WRITE_SOURCE_COUNT, 21);
  assert.deepEqual(WRITE_SURFACE_COUNTS.categoryCounts, {
    client_direct_writer: 20,
    callable_writer: 21,
    transaction_writer: 14,
    scheduled_writer: 1,
    auth_global_writer: 4,
  });
});

test("registry v2 adds the exact reservation reversal transaction writer", () => {
  const helperName = "reversePrivateReservationOutcomeInTransaction";
  const entries = ACADEMY_RESET_WRITE_SURFACE_REGISTRY.filter(
      ({entryHelper}) => entryHelper === helperName,
  );
  assert.deepEqual(entries, [{
    category: "transaction_writer",
    sourceFile: "functions/index.js",
    entryHelper: helperName,
    collections: [
      "studentPackages", "privateLessonReservations", "creditTransactions",
    ],
    operationClass: ["create", "update", "transaction"],
    scope: "academy_scoped_admin_sdk_transaction",
    guardRequirement:
      "authorized actor, guarded academy, and exact reversal evidence",
  }]);
  const accountingHelperName =
    "applyPrivateReservationOutcomeReversalAccountingInTransaction";
  const accountingEntries = ACADEMY_RESET_WRITE_SURFACE_REGISTRY.filter(
      ({entryHelper}) => entryHelper === accountingHelperName,
  );
  assert.deepEqual(accountingEntries, [{
    category: "transaction_writer",
    sourceFile: "functions/index.js",
    entryHelper: accountingHelperName,
    collections: ["studentPackages", "creditTransactions"],
    operationClass: ["create", "update", "transaction"],
    scope: "academy_scoped_admin_sdk_transaction",
    guardRequirement:
      "enclosing guarded direct or fixed reversal transaction and exact " +
      "active deduction evidence",
  }]);
  const transactionFixedCommitIndex =
    ACADEMY_RESET_WRITE_SURFACE_REGISTRY.findIndex(
        ({category, sourceFile, entryHelper}) =>
          category === "transaction_writer" &&
          sourceFile === "functions/index.js" &&
          entryHelper === "commitFixedPrivateLessonOutcomeAction",
    );
  const accountingHelperIndex =
    ACADEMY_RESET_WRITE_SURFACE_REGISTRY.findIndex(
        ({category, sourceFile, entryHelper}) =>
          category === "transaction_writer" &&
          sourceFile === "functions/index.js" &&
          entryHelper === accountingHelperName,
    );
  const directReversalIndex =
    ACADEMY_RESET_WRITE_SURFACE_REGISTRY.findIndex(
        ({category, sourceFile, entryHelper}) =>
          category === "transaction_writer" &&
          sourceFile === "functions/index.js" &&
          entryHelper === helperName,
    );
  assert.ok(transactionFixedCommitIndex >= 0);
  assert.ok(accountingHelperIndex >= 0);
  assert.ok(directReversalIndex >= 0);
  assert.equal(accountingHelperIndex, transactionFixedCommitIndex + 1);
  assert.equal(directReversalIndex, accountingHelperIndex + 1);
  const identities =
    ACADEMY_RESET_WRITE_SURFACE_REGISTRY.map(writeSurfaceIdentity);
  assert.equal(new Set(identities).size, 60);
  assert.equal(identities.filter((identity) =>
    identity.includes("*") || identity.toLowerCase().includes("default"),
  ).length, 0);

  const sourcePins = new Map(
      WRITE_SOURCE_SHA256_ALLOWLIST.map(({sourceFile, sha256}) =>
        [sourceFile, sha256]),
  );
  assert.equal(
      sourcePins.get("Dashboard.jsx"),
      "e7c2ce0daf1a1a0ea5daa89fe683d8e5f0fdb363c713a0e6d153fd195d4080a5",
  );
  assert.equal(
      sourcePins.get("functions/index.js"),
      "5220bb83e36d50cf9aea75527f33d37bbf44877569e21ed20ac457928adffe8e",
  );
});

test("every writer has machine-readable exact metadata", () => {
  const expectedKeys = [
    "category",
    "collections",
    "entryHelper",
    "guardRequirement",
    "operationClass",
    "scope",
    "sourceFile",
  ];
  for (const writer of ACADEMY_RESET_WRITE_SURFACE_REGISTRY) {
    assert.deepEqual(Object.keys(writer).sort(), expectedKeys);
    assert.equal(Object.isFrozen(writer), true);
    assert.equal(Object.isFrozen(writer.collections), true);
    assert.equal(Object.isFrozen(writer.operationClass), true);
  }
  assert.equal(
      EXPECTED_WRITE_SURFACE_IDENTITIES.length,
      ACADEMY_RESET_WRITE_SURFACE_REGISTRY.length,
  );
  assert.equal(assertWriteSurfaceRegistry().writerCount, 60);
  assert.equal(
      EXPECTED_WRITE_SURFACE_IDENTITY_DIGEST,
      "46dd9fc647cf00c10a2c474c87e272f7c76931d36b1fd16b0ec7f92491fde91e",
  );
  assert.equal(
      writeSurfaceIdentityDigest(ACADEMY_RESET_WRITE_SURFACE_REGISTRY),
      EXPECTED_WRITE_SURFACE_IDENTITY_DIGEST,
  );
  assert.equal(
      writeSourceIdentityDigest(WRITE_SOURCE_SHA256_ALLOWLIST),
      EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST,
  );
  assert.equal(assertWriteSourceIdentityAllowlist(), true);
});

test("registry validation fails closed on duplicate, unknown, and missing", () => {
  const first = ACADEMY_RESET_WRITE_SURFACE_REGISTRY[0];
  assert.throws(
      () => assertWriteSurfaceRegistry([
        ...ACADEMY_RESET_WRITE_SURFACE_REGISTRY,
        first,
      ]),
      /Duplicate writer entry/,
  );

  const unknownCollection = {
    ...first,
    collections: [...first.collections, "unknownCollection"],
  };
  assert.throws(
      () => assertWriteSurfaceRegistry([
        unknownCollection,
        ...ACADEMY_RESET_WRITE_SURFACE_REGISTRY.slice(1),
      ]),
      /Unknown or duplicate collection/,
  );

  const unknownField = {...first, surprise: true};
  assert.throws(
      () => assertWriteSurfaceRegistry([
        unknownField,
        ...ACADEMY_RESET_WRITE_SURFACE_REGISTRY.slice(1),
      ]),
      /unknown or missing fields/,
  );

  assert.throws(
      () => assertWriteSurfaceRegistry(
          ACADEMY_RESET_WRITE_SURFACE_REGISTRY.slice(1),
      ),
      /exact coverage invariant/,
  );

  const changed = [
    {...first, entryHelper: `${first.entryHelper}Changed`},
    ...ACADEMY_RESET_WRITE_SURFACE_REGISTRY.slice(1),
  ];
  const selfDerivedExpected = changed.map(writeSurfaceIdentity).sort();
  assert.throws(
      () => assertWriteSurfaceRegistry(changed, selfDerivedExpected),
      /exact coverage invariant/,
  );
  const sourceChanged = WRITE_SOURCE_SHA256_ALLOWLIST.map((entry, index) =>
    index === 0 ? {...entry, sha256: "0".repeat(64)} : entry);
  assert.throws(
      () => assertWriteSourceIdentityAllowlist(sourceChanged),
      /exact identity invariant/,
  );
});

test("all registry collections are members of the reset collection allowlist", () => {
  const allowed = new Set(RESET_COLLECTIONS);
  const covered = new Set();
  for (const writer of ACADEMY_RESET_WRITE_SURFACE_REGISTRY) {
    writer.collections.forEach((collection) => {
      assert.equal(allowed.has(collection), true, collection);
      covered.add(collection);
    });
  }
  assert.equal(covered.size > 0, true);
});
