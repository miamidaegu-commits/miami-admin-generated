const STUDENT_ACCOUNT_PERMISSIONS = {
  canManageAttendance: false,
  canAddStudent: false,
  canEditStudent: false,
  canDeleteStudent: false,
  canEditLesson: false,
  canDeleteLesson: false,
  canCreateLessonDirectly: false,
  requiresLessonApproval: false,
};

const TEACHER_ACCOUNT_PERMISSIONS = {
  canManageAttendance: false,
  canAddStudent: false,
  canEditStudent: false,
  canDeleteStudent: false,
  canEditLesson: false,
  canDeleteLesson: false,
  canCreateLessonDirectly: false,
  requiresLessonApproval: true,
};

const PROTECTED_ACCOUNT_ROLES = new Set(["owner", "admin", "teacher", "staff"]);
const TEACHER_INCOMPATIBLE_ACCOUNT_ROLES =
  new Set(["owner", "admin", "student", "staff"]);

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email");
  }
  return email;
}

function validateAcademyId(academyId) {
  if (!academyId || academyId === "academy_default") {
    throw new Error("Refusing to link student account without a real academy id");
  }
}

function assertSafeStudentAccountLink({
  uid,
  targetStudentId,
  authCustomClaims,
  userProfile,
  sameAcademyMembership,
  matchingStudentMemberships = [],
}) {
  const normalizedUid = normalizeId(uid);
  const normalizedTargetStudentId = normalizeId(targetStudentId);
  if (!normalizedTargetStudentId) {
    throw new Error("Refusing to link: missing studentId");
  }

  const customClaimRole = normalizeRole(authCustomClaims && authCustomClaims.role);
  if (PROTECTED_ACCOUNT_ROLES.has(customClaimRole)) {
    throw new Error(
        `Refusing to link: existing auth customClaims role is ${customClaimRole}`,
    );
  }

  const userRole = normalizeRole(userProfile && userProfile.role);
  if (PROTECTED_ACCOUNT_ROLES.has(userRole)) {
    throw new Error(`Refusing to convert existing ${userRole} user into student`);
  }
  if (userRole && userRole !== "student") {
    throw new Error(`Refusing to convert existing ${userRole} user into student`);
  }

  let alreadyLinked = false;
  if (sameAcademyMembership) {
    const membershipRole = normalizeRole(sameAcademyMembership.role);
    if (PROTECTED_ACCOUNT_ROLES.has(membershipRole)) {
      throw new Error(
          `Refusing to link: existing academy membership role is ${membershipRole}`,
      );
    }
    if (membershipRole !== "student") {
      throw new Error(
          `Refusing to link: existing academy membership role is ` +
          `${membershipRole || "missing"}`,
      );
    }

    const existingStudentId = normalizeId(sameAcademyMembership.studentId);
    if (!existingStudentId) {
      alreadyLinked = false;
    } else if (existingStudentId === normalizedTargetStudentId) {
      alreadyLinked = true;
    } else {
      throw new Error(
          "Refusing to link: existing student membership is linked to a different studentId",
      );
    }
  }

  for (const membership of matchingStudentMemberships) {
    const data = (membership && (membership.data || membership)) || {};
    const membershipUid = normalizeId(data.uid);
    const membershipRole = normalizeRole(data.role);
    const membershipStatus = normalizeRole(data.status);
    if (
      membershipUid &&
      membershipUid !== normalizedUid &&
      membershipRole === "student" &&
      (membershipStatus === "active" || membershipStatus === "disabled")
    ) {
      throw new Error(
          "Refusing to link: this studentId is already linked to another uid",
      );
    }
  }

  return {alreadyLinked};
}

function assertSafeTeacherAccountLink({
  targetTeacherKey,
  authCustomClaims,
  userProfile,
  sameAcademyMembership,
}) {
  const normalizedTargetTeacherKey = normalizeId(targetTeacherKey);
  if (!normalizedTargetTeacherKey) {
    throw new Error("Refusing to link: missing teacherKey");
  }

  const customClaimRole = normalizeRole(
      authCustomClaims && authCustomClaims.role,
  );
  if (TEACHER_INCOMPATIBLE_ACCOUNT_ROLES.has(customClaimRole)) {
    throw new Error(
        `Refusing to link: existing auth customClaims role is ` +
        `${customClaimRole}`,
    );
  }
  if (customClaimRole && customClaimRole !== "teacher") {
    throw new Error(
        `Refusing to link: existing auth customClaims role is ` +
        `${customClaimRole}`,
    );
  }

  const userRole = normalizeRole(userProfile && userProfile.role);
  if (TEACHER_INCOMPATIBLE_ACCOUNT_ROLES.has(userRole)) {
    throw new Error(`Refusing to convert existing ${userRole} user into teacher`);
  }
  if (userRole && userRole !== "teacher") {
    throw new Error(`Refusing to convert existing ${userRole} user into teacher`);
  }

  let alreadyLinked = false;
  if (sameAcademyMembership) {
    const membershipRole = normalizeRole(sameAcademyMembership.role);
    if (TEACHER_INCOMPATIBLE_ACCOUNT_ROLES.has(membershipRole)) {
      throw new Error(
          `Refusing to link: existing academy membership role is ` +
          `${membershipRole}`,
      );
    }
    if (membershipRole && membershipRole !== "teacher") {
      throw new Error(
          `Refusing to link: existing academy membership role is ` +
          `${membershipRole}`,
      );
    }

    const existingTeacherName = normalizeId(sameAcademyMembership.teacherName);
    if (!existingTeacherName) {
      alreadyLinked = false;
    } else if (existingTeacherName === normalizedTargetTeacherKey) {
      alreadyLinked = true;
    } else {
      throw new Error(
          "Refusing to link: existing teacher membership is linked to " +
          "a different teacherName",
      );
    }
  }

  return {alreadyLinked};
}

module.exports = {
  PROTECTED_ACCOUNT_ROLES,
  STUDENT_ACCOUNT_PERMISSIONS,
  TEACHER_ACCOUNT_PERMISSIONS,
  TEACHER_INCOMPATIBLE_ACCOUNT_ROLES,
  assertSafeStudentAccountLink,
  assertSafeTeacherAccountLink,
  normalizeEmail,
  normalizeId,
  normalizeRole,
  validateAcademyId,
};
