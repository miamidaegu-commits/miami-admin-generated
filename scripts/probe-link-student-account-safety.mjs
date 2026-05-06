import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertSafeStudentAccountLink } = require('../functions/linkStudentAccountSafety.cjs');

function expectAllowed(name, input, expected = {}) {
  const result = assertSafeStudentAccountLink(input);
  assert.deepEqual(result, { alreadyLinked: expected.alreadyLinked === true });
  console.log(JSON.stringify({ name, ok: true, result }));
}

function expectRejected(name, input, messageIncludes) {
  assert.throws(
    () => assertSafeStudentAccountLink(input),
    (error) => {
      assert.match(error.message, messageIncludes);
      return true;
    }
  );
  console.log(JSON.stringify({ name, ok: true, rejected: true }));
}

const base = {
  uid: 'uid_student',
  targetStudentId: 'student_a',
  userProfile: null,
  authCustomClaims: null,
  sameAcademyMembership: null,
  matchingStudentMemberships: [],
};

expectAllowed('new_email_links_successfully', base);

expectAllowed(
  'same_command_rerun_is_idempotent',
  {
    ...base,
    userProfile: { role: 'student' },
    sameAcademyMembership: {
      uid: 'uid_student',
      role: 'student',
      studentId: 'student_a',
      status: 'active',
    },
    matchingStudentMemberships: [
      {
        id: 'academy_uid_student',
        data: {
          uid: 'uid_student',
          role: 'student',
          studentId: 'student_a',
          status: 'active',
        },
      },
    ],
  },
  { alreadyLinked: true }
);

expectAllowed('existing_student_membership_with_empty_student_id_can_link', {
  ...base,
  userProfile: { role: 'student' },
  sameAcademyMembership: {
    uid: 'uid_student',
    role: 'student',
    studentId: '',
    status: 'active',
  },
});

expectRejected(
  'existing_admin_user_is_rejected',
  {
    ...base,
    userProfile: { role: 'admin' },
  },
  /Refusing to convert existing admin user into student/
);

expectRejected(
  'existing_teacher_user_is_rejected',
  {
    ...base,
    userProfile: { role: 'teacher' },
  },
  /Refusing to convert existing teacher user into student/
);

expectRejected(
  'existing_auth_custom_claim_admin_is_rejected',
  {
    ...base,
    authCustomClaims: { role: 'admin' },
    userProfile: { role: 'student' },
  },
  /existing auth customClaims role is admin/
);

expectRejected(
  'existing_auth_custom_claim_teacher_is_rejected',
  {
    ...base,
    authCustomClaims: { role: 'teacher' },
    userProfile: { role: 'student' },
  },
  /existing auth customClaims role is teacher/
);

expectRejected(
  'existing_admin_membership_is_rejected',
  {
    ...base,
    userProfile: { role: 'student' },
    sameAcademyMembership: {
      uid: 'uid_student',
      role: 'admin',
      studentId: '',
      status: 'active',
    },
  },
  /existing academy membership role is admin/
);

expectRejected(
  'student_id_linked_to_another_uid_is_rejected',
  {
    ...base,
    matchingStudentMemberships: [
      {
        id: 'academy_uid_other',
        data: {
          uid: 'uid_other',
          role: 'student',
          studentId: 'student_a',
          status: 'active',
        },
      },
    ],
  },
  /this studentId is already linked to another uid/
);

expectRejected(
  'student_id_disabled_linked_to_another_uid_is_rejected',
  {
    ...base,
    matchingStudentMemberships: [
      {
        id: 'academy_uid_other',
        data: {
          uid: 'uid_other',
          role: 'student',
          studentId: 'student_a',
          status: 'disabled',
        },
      },
    ],
  },
  /this studentId is already linked to another uid/
);

expectRejected(
  'same_student_uid_linked_to_different_student_id_is_rejected',
  {
    ...base,
    userProfile: { role: 'student' },
    sameAcademyMembership: {
      uid: 'uid_student',
      role: 'student',
      studentId: 'student_b',
      status: 'active',
    },
  },
  /different studentId/
);
