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
  assertWriteSourceIdentityAllowlist,
  assertWriteSurfaceRegistry,
  writeSourceIdentityDigest,
  writeSurfaceIdentity,
  writeSurfaceIdentityDigest,
} from "../functions/scripts/academy-reset-write-surface-registry.mjs";

test("registry pins 29 reset collections and exact writer category counts", () => {
  assert.equal(RESET_COLLECTIONS.length, 29);
  assert.equal(new Set(RESET_COLLECTIONS).size, 29);
  assert.equal(WRITE_SURFACE_COUNTS.writerCount, 58);
  assert.equal(EXPECTED_WRITE_SURFACE_COUNT, 58);
  assert.equal(EXPECTED_WRITE_SOURCE_COUNT, 21);
  assert.deepEqual(WRITE_SURFACE_COUNTS.categoryCounts, {
    client_direct_writer: 20,
    callable_writer: 21,
    transaction_writer: 12,
    scheduled_writer: 1,
    auth_global_writer: 4,
  });
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
  assert.equal(assertWriteSurfaceRegistry().writerCount, 58);
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
