const {setGlobalOptions} = require("firebase-functions/v2");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

setGlobalOptions({maxInstances: 10});

const OWNER_EMAIL = "miamidaegu@gmail.com";

exports.bootstrapAdmin = onCall(
    {region: "us-central1", cors: true},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Login required.");
      }

      const callerUid = request.auth.uid;
      const callerEmail = request.auth.token.email || "";

      if (callerEmail !== OWNER_EMAIL) {
        throw new HttpsError("permission-denied", "Not allowed.");
      }

      await admin.auth().setCustomUserClaims(callerUid, {
        role: "admin",
      });

      await admin.firestore().collection("users").doc(callerUid).set(
          {
            email: callerEmail,
            role: "admin",
            isActive: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
      );

      return {
        success: true,
        message: "You are now admin. Please refresh your token.",
      };
    },
);

exports.setUserRole = onCall(
    {region: "us-central1", cors: true},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Login required.");
      }

      const callerUid = request.auth.uid;
      const caller = await admin.auth().getUser(callerUid);
      const callerRole = caller.customClaims ? caller.customClaims.role : null;
      if (callerRole !== "admin") {
        throw new HttpsError("permission-denied", "Admins only.");
      }

      const {uid, role, academyId, teacherName, isActive} = request.data || {};

      if (!uid || !role) {
        throw new HttpsError("invalid-argument", "uid and role are required.");
      }

      if (!["admin", "teacher"].includes(role)) {
        throw new HttpsError(
            "invalid-argument",
            "role must be admin or teacher.",
        );
      }

      await admin.auth().setCustomUserClaims(uid, {role});

      await admin.firestore().collection("users").doc(uid).set(
          {
            role,
            academyId: academyId || null,
            teacherName: teacherName || null,
            isActive: isActive !== false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
      );

      return {
        success: true,
        message: `Role ${role} set for ${uid}`,
      };
    },
);
