/* eslint-disable require-jsdoc */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const admin = require("../functions/node_modules/firebase-admin");
const {
  RESET_WRITE_FREEZE_MODE,
  RESET_WRITE_FREEZE_SCHEMA_VERSION,
  TARGET_ACADEMY_ID,
  TARGET_PROJECT_ID,
  assertAcademyResetWriteAllowed,
  assertGlobalResetWriteAllowed,
  createGlobalFreezeGuardedHandler,
} = require("../functions/academy-reset-write-freeze.js");

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const enabled = emulatorHost !== "";
const originalRuntimeEnvironment = {
  AUTO_DEDUCT_LESSONS_ENABLED: process.env.AUTO_DEDUCT_LESSONS_ENABLED,
  FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
};

if (enabled) {
  process.env.AUTO_DEDUCT_LESSONS_ENABLED = "true";
  process.env.FIREBASE_CONFIG = JSON.stringify({projectId: TARGET_PROJECT_ID});
  process.env.GCLOUD_PROJECT = TARGET_PROJECT_ID;
  process.env.GOOGLE_CLOUD_PROJECT = TARGET_PROJECT_ID;
}

function sentinel(active, overrides = {}) {
  return {
    active,
    schemaVersion: RESET_WRITE_FREEZE_SCHEMA_VERSION,
    mode: RESET_WRITE_FREEZE_MODE,
    academyId: TARGET_ACADEMY_ID,
    projectId: TARGET_PROJECT_ID,
    ...overrides,
  };
}

async function expectFrozen(operation, reason = "reset_write_freeze_active") {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, "failed-precondition");
    assert.equal(error?.details?.reason, reason);
    return true;
  });
}

test(
    "Functions freeze guards use a real Firestore emulator transaction",
    {skip: !enabled},
    async (t) => {
      const suffix = `${process.pid}-${Date.now()}`;
      const functions = require("../functions/index.js");
      const app = admin.app();
      const db = app.firestore();
      const academyRef = db.collection("academies").doc(TARGET_ACADEMY_ID);
      const fixtureRef = db.collection("privateStudents")
          .doc(`freeze-functions-${suffix}`);
      const originalAcademy = await academyRef.get();

      async function setSentinel(value) {
        await academyRef.set({resetWriteFreeze: value});
      }

      async function guardedTransaction(writeSurfaceId) {
        return db.runTransaction(async (transaction) => {
          await assertAcademyResetWriteAllowed({
            db,
            transaction,
            academyId: TARGET_ACADEMY_ID,
            projectId: TARGET_PROJECT_ID,
            writeSurfaceId,
          });
          transaction.set(fixtureRef, {
            academyId: TARGET_ACADEMY_ID,
            fixture: true,
          });
        });
      }

      try {
        await setSentinel(sentinel(true));

        await t.test("transaction callable is denied before fixture write", async () => {
          await expectFrozen(() => guardedTransaction("reserveGroupLessonSeat"));
          assert.equal((await fixtureRef.get()).exists, false);
        });

        await t.test("non-transaction callable guard is denied", async () => {
          await expectFrozen(() => assertAcademyResetWriteAllowed({
            db,
            academyId: TARGET_ACADEMY_ID,
            projectId: TARGET_PROJECT_ID,
            writeSurfaceId: "updateTeacherStudentPackageCounts",
          }));
        });

        await t.test("scheduled writer guard is denied", async () => {
          await expectFrozen(() => assertAcademyResetWriteAllowed({
            db,
            academyId: TARGET_ACADEMY_ID,
            projectId: TARGET_PROJECT_ID,
            writeSurfaceId: "autoDeductPendingLessons",
          }));
        });

        await t.test(
            "active freeze blocks disabled metadata and mutations",
            async () => {
              const calls = {
                isEnabled: 0,
                onDisabled: 0,
                runner: 0,
                writes: 0,
                authMutations: 0,
              };
              const handler = createGlobalFreezeGuardedHandler({
                getDb: () => db,
                guardGlobalWrite: ({db: guardedDb, writeSurfaceId}) =>
                  assertGlobalResetWriteAllowed({
                    db: guardedDb,
                    projectId: TARGET_PROJECT_ID,
                    writeSurfaceId,
                  }),
                isEnabled: () => {
                  calls.isEnabled += 1;
                  return false;
                },
                onDisabled: () => {
                  calls.onDisabled += 1;
                  return {disabled: true};
                },
                runner: async () => {
                  calls.runner += 1;
                  await fixtureRef.set({unexpected: true});
                  calls.writes += 1;
                  calls.authMutations += 1;
                  return {ran: true};
                },
                writeSurfaceId: "autoDeductPendingLessons",
              });

              await expectFrozen(() => handler());
              assert.deepEqual(
                  calls,
                  {
                    isEnabled: 0,
                    onDisabled: 0,
                    runner: 0,
                    writes: 0,
                    authMutations: 0,
                  },
              );
              assert.equal((await fixtureRef.get()).exists, false);
            },
        );

        await t.test(
            "actual disabled scheduled export is denied while frozen",
            async () => {
              process.env.AUTO_DEDUCT_LESSONS_ENABLED = "false";
              try {
                await expectFrozen(
                    () => functions.autoDeductPendingLessons.run({}),
                );
                assert.equal((await fixtureRef.get()).exists, false);
              } finally {
                process.env.AUTO_DEDUCT_LESSONS_ENABLED = "true";
              }
            },
        );

        await t.test("Auth and provisioning guard is denied", async () => {
          await expectFrozen(() => assertGlobalResetWriteAllowed({
            db,
            projectId: TARGET_PROJECT_ID,
            writeSurfaceId: "linkTeacherAccount",
          }));
        });

        await t.test("malformed inactive sentinel fails closed", async () => {
          await setSentinel({
            ...sentinel(false),
            unknownField: true,
          });
          await expectFrozen(
              () => guardedTransaction("reserveGroupLessonSeat"),
              "sentinel_keys_invalid",
          );
          assert.equal((await fixtureRef.get()).exists, false);
        });

        await t.test("valid inactive sentinel permits controlled fixture write", async () => {
          await setSentinel(sentinel(false));
          await guardedTransaction("reserveGroupLessonSeat");
          assert.equal((await fixtureRef.get()).exists, true);
          await fixtureRef.delete();
        });

        await t.test(
            "inactive sentinel preserves controlled and actual runner paths",
            async () => {
              await setSentinel(sentinel(false));
              const calls = {runner: 0, writes: 0, authMutations: 0};
              const handler = createGlobalFreezeGuardedHandler({
                getDb: () => db,
                guardGlobalWrite: ({db: guardedDb, writeSurfaceId}) =>
                  assertGlobalResetWriteAllowed({
                    db: guardedDb,
                    projectId: TARGET_PROJECT_ID,
                    writeSurfaceId,
                  }),
                isEnabled: () => true,
                onDisabled: () => ({disabled: true}),
                runner: async () => {
                  calls.runner += 1;
                  await fixtureRef.set({controlledRunner: true});
                  calls.writes += 1;
                  return {ran: true};
                },
                writeSurfaceId: "autoDeductPendingLessons",
              });

              assert.deepEqual(await handler(), {ran: true});
              assert.deepEqual(
                  calls,
                  {runner: 1, writes: 1, authMutations: 0},
              );
              await fixtureRef.delete();

              const summary = await functions.autoDeductPendingLessons.run({});
              assert.equal(summary.dryRun, false);
              assert.ok(summary.academies[TARGET_ACADEMY_ID]);
              assert.equal((await fixtureRef.get()).exists, false);
            },
        );

        await t.test("other academy remains outside the target freeze", async () => {
          await setSentinel(sentinel(true));
          const result = await assertAcademyResetWriteAllowed({
            db,
            academyId: "academy_other",
            projectId: TARGET_PROJECT_ID,
            writeSurfaceId: "reserveGroupLessonSeat",
          });
          assert.deepEqual(result, {
            allowed: true,
            reason: "outside_exact_target",
          });
        });
      } finally {
        await fixtureRef.delete().catch(() => undefined);
        if (originalAcademy.exists) {
          await academyRef.set(originalAcademy.data());
        } else {
          await academyRef.delete().catch(() => undefined);
        }
        await app.delete();
        for (const [key, value] of Object.entries(
            originalRuntimeEnvironment,
        )) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    },
);
