import assert from "node:assert/strict";
import test from "node:test";

import admin from "firebase-admin";
import {deleteApp, initializeApp} from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const emulatorEnabled = emulatorHost !== "";
const TARGET_ACADEMY = "academy_daegumiami";
const PREFIX_LOOKALIKE_ACADEMY = "academy_daegumiami_branch";
const ADJACENT_LOOKALIKE_ACADEMY = "academy_daegumiami2";
const OTHER_ACADEMY = "academy_rules_freeze_other";
const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "miami-rules-freeze-emulator";

function validSentinel(active) {
  return {
    active,
    schemaVersion: "academy_reset_write_freeze.v1",
    mode: "academy_test_data_reset",
    academyId: TARGET_ACADEMY,
    projectId: "daegu-miami-production",
  };
}

function withoutKey(value, keyToRemove) {
  return Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== keyToRemove),
  );
}

function parseLocalEmulatorHost(value) {
  const separator = value.lastIndexOf(":");
  assert.notEqual(separator, -1, "FIRESTORE_EMULATOR_HOST must include a port");
  const hostname = value.slice(0, separator).replace(/^\[|\]$/g, "");
  const port = Number(value.slice(separator + 1));
  assert.ok(
      ["127.0.0.1", "localhost", "::1"].includes(hostname),
      "Rules probes refuse non-loopback emulator hosts",
  );
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  return {hostname, port};
}

test(
    "academy reset write-freeze client policy probes",
    {skip: !emulatorEnabled},
    async (t) => {
      const {hostname, port} = parseLocalEmulatorHost(emulatorHost);
      const suffix = `${process.pid}-${Date.now()}`;
      const adminUid = `freeze-admin-${suffix}`;
      const studentUid = `freeze-student-${suffix}`;
      const teacherUid = `freeze-teacher-${suffix}`;
      const studentId = `freeze-student-record-${suffix}`;
      const adminApp = admin.initializeApp(
          {projectId: PROJECT_ID},
          `freeze-admin-app-${suffix}`,
      );
      const adminDb = admin.firestore(adminApp);
      const targetAcademyRef =
        adminDb.collection("academies").doc(TARGET_ACADEMY);
      const originalTargetAcademy = await targetAcademyRef.get();
      const fixtureRefs = [];
      const fixturePaths = new Set();
      const clientApps = [];
      let probeCount = 0;

      function clientFor(uid, role) {
        const app = initializeApp({
          apiKey: "demo-api-key",
          authDomain: "demo.firebaseapp.com",
          projectId: PROJECT_ID,
          appId: `freeze-${uid}`,
        }, `freeze-client-${uid}-${suffix}`);
        clientApps.push(app);
        const db = getFirestore(app);
        connectFirestoreEmulator(db, hostname, port, {
          mockUserToken: {
            sub: uid,
            user_id: uid,
            email: `${uid}@example.test`,
            role,
          },
        });
        return db;
      }

      const adminClient = clientFor(adminUid, "admin");
      const studentClient = clientFor(studentUid, "student");

      async function expectAllowed(name, operation) {
        await t.test(name, async () => {
          probeCount += 1;
          await operation();
        });
      }

      async function expectDenied(name, operation) {
        await t.test(name, async () => {
          probeCount += 1;
          await assert.rejects(operation, (error) => {
            assert.equal(
                String(error?.code || "").replace(/^firestore\//, ""),
                "permission-denied",
            );
            return true;
          });
        });
      }

      function track(collection, documentId) {
        const ref = adminDb.collection(collection).doc(documentId);
        if (!fixturePaths.has(ref.path)) {
          fixturePaths.add(ref.path);
          fixtureRefs.push(ref);
        }
        return ref;
      }

      async function setSentinel(sentinel) {
        await targetAcademyRef.set({
          name: "Rules freeze emulator fixture",
          resetWriteFreeze: sentinel,
        });
      }

      async function removeSentinel() {
        await targetAcademyRef.set({
          name: "Rules freeze emulator fixture",
          resetWriteFreeze: admin.firestore.FieldValue.delete(),
        }, {merge: true});
      }

      function privateStudentDocument(academyId, label) {
        const documentId = `freeze-private-student-${label}-${suffix}`;
        track("privateStudents", documentId);
        return doc(
            adminClient,
            "privateStudents",
            documentId,
        );
      }

      async function updateTeacherPermissions(membershipId) {
        await updateDoc(
            doc(adminClient, "academyMemberships", membershipId),
            {
              permissions: {
                canEditStudentPackageCounts: true,
                canManageOwnLessonDeductions: false,
              },
              updatedAt: serverTimestamp(),
            },
        );
      }

      async function seedBookingLesson(label) {
        const groupClassId = `freeze-group-${label}-${suffix}`;
        const lessonId = `freeze-lesson-${label}-${suffix}`;
        const reservationId =
          `${TARGET_ACADEMY}__${lessonId}__${studentId}`;
        await track("groupLessons", lessonId).set({
          academyId: TARGET_ACADEMY,
          groupClassId,
          groupCourseType: "free_talking",
          teacher: "Rules Teacher",
          date: "2026-07-16",
          time: "10:00",
          subject: `Rules ${label}`,
          capacity: 3,
          bookedCount: 0,
          isBookable: true,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });
        fixtureRefs.push(
            adminDb.collection("groupLessonReservations").doc(reservationId),
        );
        return {groupClassId, lessonId, reservationId};
      }

      async function studentBooking({groupClassId, lessonId, reservationId}) {
        const batch = writeBatch(studentClient);
        batch.set(
            doc(studentClient, "groupLessonReservations", reservationId),
            {
              academyId: TARGET_ACADEMY,
              lessonId,
              groupClassId,
              studentId,
              status: "active",
              source: "student",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              cancelledAt: null,
            },
        );
        batch.update(doc(studentClient, "groupLessons", lessonId), {
          bookedCount: 1,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      }

      try {
        await removeSentinel();
        await track(
            "academyMemberships",
            `${TARGET_ACADEMY}_${adminUid}`,
        ).set({
          academyId: TARGET_ACADEMY,
          uid: adminUid,
          role: "admin",
          status: "active",
          teacherName: "Rules Admin",
          permissions: {},
        });
        await track(
            "academyMemberships",
            `${OTHER_ACADEMY}_${adminUid}`,
        ).set({
          academyId: OTHER_ACADEMY,
          uid: adminUid,
          role: "admin",
          status: "active",
          teacherName: "Rules Admin",
          permissions: {},
        });
        for (const academyId of [
          PREFIX_LOOKALIKE_ACADEMY,
          ADJACENT_LOOKALIKE_ACADEMY,
        ]) {
          await track(
              "academyMemberships",
              `${academyId}_${adminUid}`,
          ).set({
            academyId,
            uid: adminUid,
            role: "admin",
            status: "active",
            teacherName: "Rules Admin",
            permissions: {},
          });
        }
        await track(
            "academyMemberships",
            `${TARGET_ACADEMY}_${studentUid}`,
        ).set({
          academyId: TARGET_ACADEMY,
          uid: studentUid,
          role: "student",
          studentId,
          status: "active",
          teacherName: "",
          permissions: {},
        });
        const teacherMembershipId = `${TARGET_ACADEMY}_${teacherUid}`;
        await track("academyMemberships", teacherMembershipId).set({
          academyId: TARGET_ACADEMY,
          uid: teacherUid,
          role: "teacher",
          status: "active",
          teacherName: "Rules Teacher",
          permissions: {
            canEditStudentPackageCounts: false,
            canManageOwnLessonDeductions: false,
          },
          updatedAt: admin.firestore.Timestamp.now(),
        });
        const misleadingMembershipId =
          `${TARGET_ACADEMY}_branch-teacher-${suffix}`;
        await track("academyMemberships", misleadingMembershipId).set({
          academyId: PREFIX_LOOKALIKE_ACADEMY,
          uid: `prefix-teacher-${suffix}`,
          role: "teacher",
          status: "active",
          teacherName: "Prefix Teacher",
          permissions: {
            canEditStudentPackageCounts: false,
            canManageOwnLessonDeductions: false,
          },
          updatedAt: admin.firestore.Timestamp.now(),
        });
        const malformedAcademyMembershipId =
          `${TARGET_ACADEMY}_malformed-academy-${suffix}`;
        await track("academyMemberships", malformedAcademyMembershipId).set({
          academyId: 7,
          uid: `malformed-teacher-${suffix}`,
          role: "teacher",
          status: "active",
          teacherName: "Malformed Teacher",
          permissions: {
            canEditStudentPackageCounts: false,
            canManageOwnLessonDeductions: false,
          },
          updatedAt: admin.firestore.Timestamp.now(),
        });
        const missingAcademyMembershipId =
          `${TARGET_ACADEMY}_missing-academy-${suffix}`;
        await track("academyMemberships", missingAcademyMembershipId).set({
          uid: `missing-teacher-${suffix}`,
          role: "teacher",
          status: "active",
          teacherName: "Missing Teacher",
          permissions: {
            canEditStudentPackageCounts: false,
            canManageOwnLessonDeductions: false,
          },
          updatedAt: admin.firestore.Timestamp.now(),
        });

        const inactiveBooking = await seedBookingLesson("inactive");
        const activeBooking = await seedBookingLesson("active");
        await track(
            "studentGroupAccessSummary",
            `${TARGET_ACADEMY}__${studentId}`,
        ).set({
          academyId: TARGET_ACADEMY,
          studentId,
          groupClassIds: [
            inactiveBooking.groupClassId,
            activeBooking.groupClassId,
          ],
          groupCourseTypes: ["free_talking"],
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });
        const readableStudentId = `freeze-readable-${suffix}`;
        await track("privateStudents", readableStudentId).set({
          academyId: TARGET_ACADEMY,
          name: "Readable Fixture",
        });

        await expectAllowed("absent sentinel preserves target admin write", () =>
          setDoc(privateStudentDocument(TARGET_ACADEMY, "absent"), {
            academyId: TARGET_ACADEMY,
            name: "Absent sentinel",
          }));
        await expectAllowed("absent sentinel preserves global users write", () =>
          {
            track("users", studentUid);
            return setDoc(doc(studentClient, "users", studentUid), {
              displayName: "Student",
            });
          });

        await setSentinel(validSentinel(false));
        await expectAllowed("inactive sentinel preserves target admin write", () =>
          setDoc(privateStudentDocument(TARGET_ACADEMY, "inactive"), {
            academyId: TARGET_ACADEMY,
            name: "Inactive sentinel",
          }));
        await expectAllowed("inactive sentinel preserves target student write", () =>
          studentBooking(inactiveBooking));

        const malformedInactiveSentinels = [
          ["inactive partial", {active: false}],
          ...[
            "active",
            "schemaVersion",
            "mode",
            "academyId",
            "projectId",
          ].map((key) => [
            `inactive missing ${key}`,
            withoutKey(validSentinel(false), key),
          ]),
          ["inactive unknown field", {
            ...validSentinel(false),
            unknown: true,
          }],
          ["inactive active wrong type", {
            ...validSentinel(false),
            active: "false",
          }],
          ["inactive schemaVersion wrong type", {
            ...validSentinel(false),
            schemaVersion: 1,
          }],
          ["inactive mode wrong type", {
            ...validSentinel(false),
            mode: false,
          }],
          ["inactive academyId wrong type", {
            ...validSentinel(false),
            academyId: 1,
          }],
          ["inactive projectId wrong type", {
            ...validSentinel(false),
            projectId: [],
          }],
          ["inactive schemaVersion wrong literal", {
            ...validSentinel(false),
            schemaVersion: "academy_reset_write_freeze.v2",
          }],
          ["inactive mode wrong literal", {
            ...validSentinel(false),
            mode: "other",
          }],
          ["inactive academyId wrong literal", {
            ...validSentinel(false),
            academyId: OTHER_ACADEMY,
          }],
          ["inactive projectId wrong literal", {
            ...validSentinel(false),
            projectId: "other-project",
          }],
        ];
        for (const [label, sentinel] of malformedInactiveSentinels) {
          await setSentinel(sentinel);
          await expectDenied(`${label} sentinel fails closed`, () =>
            setDoc(privateStudentDocument(TARGET_ACADEMY, label), {
              academyId: TARGET_ACADEMY,
              name: label,
            }));
        }

        const malformedSentinels = [
          ["partial", {active: true}],
          ["active wrong type", {
            ...validSentinel(true),
            active: "true",
          }],
          ["wrong mode", {...validSentinel(true), mode: "other"}],
          ["wrong academy", {
            ...validSentinel(true),
            academyId: OTHER_ACADEMY,
          }],
          ["wrong project", {
            ...validSentinel(true),
            projectId: "other-project",
          }],
          ["unsupported version", {
            ...validSentinel(true),
            schemaVersion: "academy_reset_write_freeze.v2",
          }],
          ["unknown field", {...validSentinel(true), extra: true}],
        ];
        for (const [label, sentinel] of malformedSentinels) {
          await setSentinel(sentinel);
          await expectDenied(`malformed ${label} sentinel fails closed`, () =>
            setDoc(privateStudentDocument(TARGET_ACADEMY, `malformed-${label}`), {
              academyId: TARGET_ACADEMY,
              name: `Malformed ${label}`,
            }));
        }

        await setSentinel(validSentinel(true));
        await expectDenied("active sentinel denies target admin write", () =>
          setDoc(privateStudentDocument(TARGET_ACADEMY, "active-admin"), {
            academyId: TARGET_ACADEMY,
            name: "Active admin",
          }));
        await expectDenied("active sentinel denies target student write", () =>
          studentBooking(activeBooking));
        await expectAllowed("active sentinel preserves target admin read", async () => {
          const snapshot = await getDoc(
              doc(adminClient, "privateStudents", readableStudentId),
          );
          assert.equal(snapshot.exists(), true);
        });
        await expectAllowed("active sentinel preserves target student read", async () => {
          const snapshot = await getDoc(
              doc(studentClient, "groupLessons", activeBooking.lessonId),
          );
          assert.equal(snapshot.exists(), true);
        });
        await expectAllowed("active target sentinel preserves other-academy write", () =>
          setDoc(privateStudentDocument(OTHER_ACADEMY, "other-academy"), {
            academyId: OTHER_ACADEMY,
            name: "Other academy",
          }));
        await expectAllowed("target-prefix academy keeps existing write policy", () =>
          setDoc(
              privateStudentDocument(
                  PREFIX_LOOKALIKE_ACADEMY,
                  "prefix-lookalike",
              ),
              {
                academyId: PREFIX_LOOKALIKE_ACADEMY,
                name: "Prefix lookalike academy",
              },
          ));
        await expectAllowed("adjacent academy id keeps existing write policy", () =>
          setDoc(
              privateStudentDocument(
                  ADJACENT_LOOKALIKE_ACADEMY,
                  "adjacent-lookalike",
              ),
              {
                academyId: ADJACENT_LOOKALIKE_ACADEMY,
                name: "Adjacent lookalike academy",
              },
          ));
        await expectAllowed(
            "target-prefixed membership id uses persisted non-target academyId",
            () => updateTeacherPermissions(misleadingMembershipId),
        );

        await expectDenied("active sentinel denies global admin users write", () =>
          {
            const userId = `freeze-user-${suffix}`;
            track("users", userId);
            return setDoc(doc(adminClient, "users", userId), {
              displayName: "Admin-created user",
            });
          });
        await expectDenied("active sentinel denies global self users write", () =>
          updateDoc(doc(studentClient, "users", studentUid), {
            displayName: "Frozen student",
          }));
        await expectDenied("active sentinel keeps academy shell immutable", () =>
          updateDoc(doc(adminClient, "academies", TARGET_ACADEMY), {
            name: "Client mutation",
          }));
        await expectDenied("active sentinel keeps memberships immutable", () =>
          updateTeacherPermissions(teacherMembershipId));
        await expectDenied("malformed persisted academyId fails closed", () =>
          updateTeacherPermissions(malformedAcademyMembershipId));
        await expectDenied("missing persisted academyId fails closed", () =>
          updateTeacherPermissions(missingAcademyMembershipId));
        await expectDenied("active sentinel keeps teachers immutable", () =>
          setDoc(doc(adminClient, "teachers", `freeze-teacher-${suffix}`), {
            academyId: TARGET_ACADEMY,
            name: "Client teacher",
          }));
        await expectDenied(
            "account provisioning logs remain client-immutable",
            () => setDoc(
                doc(adminClient, "accountProvisioningLogs", `freeze-log-${suffix}`),
                {academyId: TARGET_ACADEMY, status: "attempted"},
            ),
        );

        assert.equal(probeCount, 43);
        t.diagnostic(
            `${probeCount} emulator probes passed; Admin SDK was fixture-only ` +
            "and is outside Firestore Rules scope.",
        );
      } finally {
        await Promise.all(fixtureRefs.reverse().map((ref) =>
          ref.delete().catch(() => undefined)));
        if (originalTargetAcademy.exists) {
          await targetAcademyRef.set(originalTargetAcademy.data());
        } else {
          await targetAcademyRef.delete().catch(() => undefined);
        }
        await Promise.all(clientApps.map((app) =>
          deleteApp(app).catch(() => undefined)));
        await adminApp.delete();
      }
    },
);
