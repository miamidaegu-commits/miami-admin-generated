const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uid = "zqkVMuEfMteYKF1l1jbyjCih90a2";

async function run() {
  try {
    await admin.auth().setCustomUserClaims(uid, { role: "admin" });

    await admin.firestore().collection("users").doc(uid).set(
      {
        email: "miamidaegu@gmail.com",
        role: "admin",
        isActive: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log("✅ admin 권한 설정 완료");
    process.exit(0);
  } catch (error) {
    console.error("❌ 에러:", error);
    process.exit(1);
  }
}

run();

