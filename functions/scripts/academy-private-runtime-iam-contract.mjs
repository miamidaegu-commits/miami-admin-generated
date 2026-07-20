import crypto from "node:crypto";
import {
  FUNCTIONS_IDENTITIES,
  ORGANIZATION_POLICY_EVIDENCE,
  buildOrganizationPolicyLineageReference,
  computeOrganizationPolicyEvidenceDigest,
  validateOrganizationPolicyEvidence,
  validateOrganizationPolicyLineageReference,
} from "./academy-functions-build-scope-contract.mjs";

export const PRIVATE_RUNTIME_IAM_CONTRACT_VERSION =
  "academy_private_runtime_iam.v5";
export const PRIVATE_RUNTIME_IAM_SET_DIGEST_VERSION =
  "academy_private_runtime_iam_set_sha256.v1";
export const FREEZE_ACTIVATION_RECEIPT_VERSION =
  "academy_private_runtime_freeze_activation.v3";
export const UNFREEZE_RESTORATION_RECEIPT_VERSION =
  "academy_private_runtime_unfreeze_restoration.v4";
export const EXECUTABLE_APPROVAL_VERSION =
  "academy_private_runtime_executable_approval.v4";
export const EXACT_CHRONOLOGY_PROFILE_VERSION =
  "academy_private_runtime_exact_chronology.v2";
export const SERVICE_ACCOUNT_KEY_AUDIT_VERSION =
  "academy_private_runtime_service_account_key_audit.v1";
export const MAX_JIT_DURATION_NANOSECONDS_DECIMAL = "7200000000000";

const EXACT_CHRONOLOGY_PROFILE = deepFreeze({
  profileVersion: EXACT_CHRONOLOGY_PROFILE_VERSION,
  timestampGrammar: "RFC3339_UTC_Z_FRACTION_0_TO_9",
  integerRepresentation: "SIGNED_EPOCH_NANOSECONDS_BASE10",
  maximumJitDurationNanoseconds: MAX_JIT_DURATION_NANOSECONDS_DECIMAL,
  startBoundary: "INCLUSIVE",
  expiryBoundary: "EXCLUSIVE",
  equalStageBoundary: "ALLOWED",
});

export const TARGET_PROJECT_ID = "daegu-miami-production";
export const TARGET_PROJECT_NUMBER = "884850632328";
export const TARGET_PROJECT_RESOURCE = `projects/${TARGET_PROJECT_ID}`;
export const TARGET_DATABASE_ID = "(default)";
export const TARGET_DATABASE_RESOURCE =
  `${TARGET_PROJECT_RESOURCE}/databases/${TARGET_DATABASE_ID}`;
export const TARGET_DATABASE_LOCATION = "asia-northeast3";
export const TARGET_DATABASE_TYPE = "FIRESTORE_NATIVE";
export const TARGET_DATABASE_CMEK_KEY = null;
export const TARGET_DATABASE_DELETE_PROTECTION =
  "DELETE_PROTECTION_DISABLED";

export const STEADY_STATE = "steady_state";
export const FREEZE_ACTIVE_STATE = "freeze_active";
export const PRIVATE_RUNTIME_IAM_STATES =
  deepFreeze([STEADY_STATE, FREEZE_ACTIVE_STATE]);

export const BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL =
  `${TARGET_PROJECT_NUMBER}-compute@developer.gserviceaccount.com`;
export const WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL =
  `academy-private-writer-runtime@${TARGET_PROJECT_ID}.iam.gserviceaccount.com`;
export const PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL =
  `academy-private-preview-rt@${TARGET_PROJECT_ID}.iam.gserviceaccount.com`;
export const BASELINE_RUNTIME_SERVICE_ACCOUNT_MEMBER =
  `serviceAccount:${BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL}`;
export const WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER =
  `serviceAccount:${WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL}`;
export const PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER =
  `serviceAccount:${PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL}`;

export const WRITER_STEADY_ROLE_ID = "academyPrivateWriterRuntimeV1";
export const READ_ONLY_ROLE_ID = "academyBackendReadOnly";
export const WRITER_STEADY_ROLE =
  `${TARGET_PROJECT_RESOURCE}/roles/${WRITER_STEADY_ROLE_ID}`;
export const READ_ONLY_ROLE =
  `${TARGET_PROJECT_RESOURCE}/roles/${READ_ONLY_ROLE_ID}`;

export const READ_ONLY_DATASTORE_PERMISSIONS = deepFreeze([
  "datastore.databases.get",
  "datastore.entities.get",
  "datastore.entities.list",
]);
export const WRITER_STEADY_DATASTORE_PERMISSIONS = deepFreeze([
  "datastore.databases.get",
  "datastore.entities.create",
  "datastore.entities.get",
  "datastore.entities.list",
  "datastore.entities.update",
]);
export const APPROVED_DATASTORE_PERMISSION_UNIVERSE = deepFreeze([
  ...new Set([
    ...READ_ONLY_DATASTORE_PERMISSIONS,
    ...WRITER_STEADY_DATASTORE_PERMISSIONS,
  ]),
].sort());
export const WRITABLE_DATASTORE_PERMISSIONS = deepFreeze([
  "datastore.entities.create",
  "datastore.entities.update",
]);

export const DEPLOYED_FUNCTION_NAMES = deepFreeze([
  "adminCancelPrivateLessonReservation",
  "adminClosePrivateLessonSlot",
  "adminReopenPrivateLessonSlot",
  "autoDeductPendingLessons",
  "bootstrapAdmin",
  "cancelFixedPrivateLessonOccurrence",
  "cancelGroupLessonSeat",
  "cancelPrivateLessonReservation",
  "commitFixedPrivateLessonOutcomeAction",
  "commitPrivateLessonOutcomeAction",
  "commitPrivateLessonStatusAction",
  "createFixedPrivateLessonAssignment",
  "createFixedPrivateLessonRenewal",
  "inspectFixedPrivateLessonOutcomeLedger",
  "inspectFixedPrivateLessonOutcomeRemediationEvidence",
  "inspectFixedPrivateLessonRescheduleScope",
  "linkStudentAccount",
  "linkTeacherAccount",
  "listGroupLessonAvailability",
  "listPrivateLessonSlotAvailability",
  "markPrivateReservationOutcome",
  "previewFixedPrivateLessonOutcomeAction",
  "previewFixedPrivateLessonRescheduleScope",
  "previewPrivateLessonOutcomeAction",
  "previewPrivateLessonStatusAction",
  "releaseGroupLessonFixedSeat",
  "reserveGroupLessonSeat",
  "reservePrivateLessonSlot",
  "restoreGroupLessonFixedSeat",
  "reversePrivateReservationOutcome",
  "runAutoDeductPendingLessonsForTest",
  "setUserRole",
  "updateFixedPrivateLessonScheduleScope",
  "updateStudentPrivateCancelAllowance",
  "updateTeacherStudentPackageCounts",
].sort());

export const WRITER_RUNTIME_FUNCTION_NAMES = deepFreeze([
  "commitFixedPrivateLessonOutcomeAction",
  "createFixedPrivateLessonAssignment",
].sort());
export const PREVIEW_RUNTIME_FUNCTION_NAMES = deepFreeze([
  "previewFixedPrivateLessonOutcomeAction",
]);
export const BASELINE_RUNTIME_FUNCTION_NAMES = deepFreeze(
    DEPLOYED_FUNCTION_NAMES.filter((functionName) =>
      !WRITER_RUNTIME_FUNCTION_NAMES.includes(functionName) &&
      !PREVIEW_RUNTIME_FUNCTION_NAMES.includes(functionName)),
);

export const FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING = deepFreeze(
    DEPLOYED_FUNCTION_NAMES.map((functionName) => ({
      functionName,
      serviceAccountEmail:
        WRITER_RUNTIME_FUNCTION_NAMES.includes(functionName) ?
          WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL :
          PREVIEW_RUNTIME_FUNCTION_NAMES.includes(functionName) ?
            PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL :
            BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL,
    })),
);

function fail(message) {
  throw new Error(`Academy private runtime IAM contract rejected: ${message}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

export const EXECUTION_PRINCIPAL_RECEIPT_FIELDS = deepFreeze([
  "impersonationPrincipal",
  "invokerOperatorPrincipal",
  "provisioningPrincipal",
]);
export const EXECUTION_SERVICE_ACCOUNT_EMAILS = deepFreeze([
  FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
  FUNCTIONS_IDENTITIES.deployServiceAccount,
  PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL,
].sort());

function assertPlainData(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(`${label} contains a symbol key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(`${label}.${key} must be an enumerable data property`);
    }
  }
}

function assertExactKeys(value, keys, label) {
  assertPlainData(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} exact key set mismatch`);
  }
}

export function canonicalJson(value) {
  if (value === undefined) fail("undefined is not canonical");
  if (value === null) return "null";
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || !["string", "number", "boolean"]
        .includes(typeof value)) {
      fail("unsupported canonical value");
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      fail("non-finite numbers are not canonical");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    const actualKeys = Reflect.ownKeys(value).sort();
    const expectedKeys = [
      ...Array.from({length: value.length}, (_, index) => String(index)),
      "length",
    ].sort();
    if (!sameStringArrays(actualKeys, expectedKeys)) {
      fail("sparse or custom arrays are not canonical");
    }
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  assertPlainData(value, "canonical object");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sameStringArrays(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function normalizedCanonicalSet(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array`);
  const byCanonicalValue = new Map();
  for (const value of values) {
    const encoded = canonicalJson(value);
    if (byCanonicalValue.has(encoded)) fail(`${label} contains a duplicate`);
    byCanonicalValue.set(encoded, value);
  }
  return [...byCanonicalValue.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => value);
}

export function buildCanonicalSetDigest(values, setName = "canonical") {
  if (typeof setName !== "string" || setName.length === 0) {
    fail("setName must be a non-empty string");
  }
  const elements = normalizedCanonicalSet(values, setName);
  return canonicalDigest({
    algorithm: PRIVATE_RUNTIME_IAM_SET_DIGEST_VERSION,
    setName,
    elements,
  });
}

export function buildPermissionSetDigest(permissionRecords) {
  if (!Array.isArray(permissionRecords)) {
    fail("principal_permissions must be an array");
  }
  const normalized = permissionRecords.map((record, index) => {
    assertExactKeys(
        record,
        ["member", "permissions"],
        `principal_permissions[${index}]`,
    );
    if (typeof record.member !== "string" ||
        !Array.isArray(record.permissions) ||
        record.permissions.some((permission) =>
          typeof permission !== "string") ||
        new Set(record.permissions).size !== record.permissions.length) {
      fail(`principal_permissions[${index}] is invalid`);
    }
    return {
      member: record.member,
      permissions: [...record.permissions].sort(),
    };
  });
  return buildCanonicalSetDigest(normalized, "principal_permissions");
}

export function buildBindingSetDigest(bindings) {
  return buildCanonicalSetDigest(bindings, "project_iam_bindings");
}

function binding(member, role) {
  return {
    attachmentPoint: TARGET_PROJECT_RESOURCE,
    member,
    role,
    inherited: false,
    condition: null,
  };
}

function permissionRecord(member, permissions) {
  return {member, permissions: [...permissions].sort()};
}

function expectedBindings(state) {
  return [
    binding(BASELINE_RUNTIME_SERVICE_ACCOUNT_MEMBER, READ_ONLY_ROLE),
    binding(PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER, READ_ONLY_ROLE),
    binding(
        WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER,
        state === STEADY_STATE ? WRITER_STEADY_ROLE : READ_ONLY_ROLE,
    ),
  ];
}

function expectedPermissionRecords(state) {
  return [
    permissionRecord(
        BASELINE_RUNTIME_SERVICE_ACCOUNT_MEMBER,
        READ_ONLY_DATASTORE_PERMISSIONS,
    ),
    permissionRecord(
        PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER,
        READ_ONLY_DATASTORE_PERMISSIONS,
    ),
    permissionRecord(
        WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER,
        state === STEADY_STATE ?
          WRITER_STEADY_DATASTORE_PERMISSIONS :
          READ_ONLY_DATASTORE_PERMISSIONS,
    ),
  ];
}

export const EXPECTED_BINDINGS_BY_STATE = deepFreeze({
  [STEADY_STATE]: expectedBindings(STEADY_STATE),
  [FREEZE_ACTIVE_STATE]: expectedBindings(FREEZE_ACTIVE_STATE),
});
export const EXPECTED_PERMISSION_SETS_BY_STATE = deepFreeze({
  [STEADY_STATE]: expectedPermissionRecords(STEADY_STATE),
  [FREEZE_ACTIVE_STATE]: expectedPermissionRecords(FREEZE_ACTIVE_STATE),
});
export const EXPECTED_BINDING_SET_DIGESTS_BY_STATE = deepFreeze(
    Object.fromEntries(PRIVATE_RUNTIME_IAM_STATES.map((state) => [
      state,
      buildBindingSetDigest(EXPECTED_BINDINGS_BY_STATE[state]),
    ])),
);
export const EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE = deepFreeze(
    Object.fromEntries(PRIVATE_RUNTIME_IAM_STATES.map((state) => [
      state,
      buildPermissionSetDigest(EXPECTED_PERMISSION_SETS_BY_STATE[state]),
    ])),
);

function contractDigestProjection(contract) {
  const {contractDigest: ignored, ...projection} = contract;
  return projection;
}

const contractWithoutDigest = {
  schemaVersion: PRIVATE_RUNTIME_IAM_CONTRACT_VERSION,
  exactChronologyProfile: EXACT_CHRONOLOGY_PROFILE,
  executionPrincipalReceipt: {
    fields: EXECUTION_PRINCIPAL_RECEIPT_FIELDS,
    resolution: "EXACT_RECEIPT_REQUIRED_NO_SOURCE_DEFAULT",
    placeholderDisposition: "REJECT",
    inferredCurrentUserDisposition: "REJECT",
  },
  serviceAccountKeyAudit: {
    schemaVersion: SERVICE_ACCOUNT_KEY_AUDIT_VERSION,
    serviceAccountEmails: EXECUTION_SERVICE_ACCOUNT_EMAILS,
    requiredUserManagedKeyCount: 0,
  },
  organizationPolicyAuthority: {
    evidence: ORGANIZATION_POLICY_EVIDENCE,
    lineage: buildOrganizationPolicyLineageReference(),
  },
  project: {
    projectId: TARGET_PROJECT_ID,
    projectNumber: TARGET_PROJECT_NUMBER,
    resource: TARGET_PROJECT_RESOURCE,
  },
  firestoreDatabase: {
    resource: TARGET_DATABASE_RESOURCE,
    databaseId: TARGET_DATABASE_ID,
    locationId: TARGET_DATABASE_LOCATION,
    type: TARGET_DATABASE_TYPE,
    cmekKeyName: TARGET_DATABASE_CMEK_KEY,
    deleteProtectionState: TARGET_DATABASE_DELETE_PROTECTION,
    iamAttachmentScope: TARGET_PROJECT_RESOURCE,
  },
  states: [...PRIVATE_RUNTIME_IAM_STATES],
  roles: {
    writerSteady: {
      role: WRITER_STEADY_ROLE,
      permissions: [...WRITER_STEADY_DATASTORE_PERMISSIONS],
    },
    readOnly: {
      role: READ_ONLY_ROLE,
      permissions: [...READ_ONLY_DATASTORE_PERMISSIONS],
    },
  },
  runtimeServiceAccounts: {
    baseline: BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL,
    writer: WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL,
    preview: PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  },
  functionRuntimeMapping: FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING,
  expectedBindingsByState: EXPECTED_BINDINGS_BY_STATE,
  expectedPermissionSetsByState: EXPECTED_PERMISSION_SETS_BY_STATE,
  expectedBindingSetDigestsByState: EXPECTED_BINDING_SET_DIGESTS_BY_STATE,
  expectedPermissionSetDigestsByState:
    EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE,
};

export const ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT = deepFreeze({
  ...contractWithoutDigest,
  contractDigest: canonicalDigest(contractWithoutDigest),
});
export const PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST =
  ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT.contractDigest;

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertState(state) {
  if (!PRIVATE_RUNTIME_IAM_STATES.includes(state)) {
    fail(`unknown state ${String(state)}`);
  }
}

export function validateFunctionRuntimeServiceAccountMapping(mapping) {
  if (!Array.isArray(mapping) || mapping.length !== 35) {
    fail("function runtime mapping must contain exactly 35 entries");
  }
  for (const [index, item] of mapping.entries()) {
    assertExactKeys(
        item,
        ["functionName", "serviceAccountEmail"],
        `functionRuntimeMapping[${index}]`,
    );
  }
  const normalized = normalizedCanonicalSet(
      mapping,
      "function runtime mapping",
  );
  const expected = normalizedCanonicalSet(
      FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING,
      "expected function runtime mapping",
  );
  if (!same(normalized, expected) ||
      mapping.some(({functionName}) => functionName === "*" ||
        functionName.toLowerCase() === "default")) {
    fail("function runtime mapping differs from the exact 35-function map");
  }
  return true;
}

export function validatePrivateRuntimeIamContract(
    contract = ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT,
) {
  assertExactKeys(contract, Object.keys(ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT),
      "contract");
  if (!same(contract, ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT) ||
      contract.contractDigest !==
        canonicalDigest(contractDigestProjection(contract))) {
    fail("contract content or digest mismatch");
  }
  validateFunctionRuntimeServiceAccountMapping(contract.functionRuntimeMapping);
  return true;
}

function assertExactPermissionRecords(records, state, label) {
  if (!Array.isArray(records)) fail(`${label} must be an array`);
  for (const [index, record] of records.entries()) {
    assertExactKeys(record, ["member", "permissions"], `${label}[${index}]`);
    if (!Array.isArray(record.permissions) ||
        new Set(record.permissions).size !== record.permissions.length) {
      fail(`${label}[${index}] has invalid permissions`);
    }
    for (const permission of record.permissions) {
      if (!APPROVED_DATASTORE_PERMISSION_UNIVERSE.includes(permission)) {
        fail(`${label} contains unknown permission ${String(permission)}`);
      }
    }
  }
  const normalized = normalizedCanonicalSet(records, label).map((record) => ({
    member: record.member,
    permissions: [...record.permissions].sort(),
  }));
  const expected = normalizedCanonicalSet(
      EXPECTED_PERMISSION_SETS_BY_STATE[state],
      `expected ${label}`,
  );
  if (!same(normalized, expected)) {
    fail(`${label} differs from exact ${state} permissions`);
  }
}

function assertExactBindings(bindings, state, label) {
  if (!Array.isArray(bindings)) fail(`${label} must be an array`);
  for (const [index, item] of bindings.entries()) {
    assertExactKeys(item, [
      "attachmentPoint", "condition", "inherited", "member", "role",
    ], `${label}[${index}]`);
    if (item.inherited !== false) fail(`${label} contains inherited binding`);
    if (item.condition !== null) fail(`${label} contains conditional binding`);
    if (item.attachmentPoint !== TARGET_PROJECT_RESOURCE) {
      fail(`${label} has a foreign attachment point`);
    }
    if (![READ_ONLY_ROLE, WRITER_STEADY_ROLE].includes(item.role)) {
      fail(`${label} contains unknown role`);
    }
  }
  const actual = normalizedCanonicalSet(bindings, label);
  const expected = normalizedCanonicalSet(
      EXPECTED_BINDINGS_BY_STATE[state],
      `expected ${label}`,
  );
  if (!same(actual, expected)) {
    fail(`${label} differs from exact ${state} bindings`);
  }
}

export function validateStateSnapshot(snapshot, state) {
  assertState(state);
  assertExactKeys(snapshot, [
    "bindingSetDigest",
    "bindings",
    "permissionSetDigest",
    "principalPermissions",
    "state",
  ], `${state} snapshot`);
  if (snapshot.state !== state) fail("snapshot state mismatch");
  assertExactBindings(snapshot.bindings, state, `${state} bindings`);
  assertExactPermissionRecords(
      snapshot.principalPermissions,
      state,
      `${state} principal permissions`,
  );
  const bindingSetDigest = buildBindingSetDigest(snapshot.bindings);
  const permissionSetDigest =
    buildPermissionSetDigest(snapshot.principalPermissions);
  if (snapshot.bindingSetDigest !== bindingSetDigest ||
      snapshot.bindingSetDigest !==
        EXPECTED_BINDING_SET_DIGESTS_BY_STATE[state] ||
      snapshot.permissionSetDigest !== permissionSetDigest ||
      snapshot.permissionSetDigest !==
        EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE[state]) {
    fail(`${state} snapshot digest mismatch`);
  }
  return true;
}

export function buildStateSnapshot(state) {
  assertState(state);
  return deepFreeze({
    state,
    bindings: EXPECTED_BINDINGS_BY_STATE[state],
    bindingSetDigest: EXPECTED_BINDING_SET_DIGESTS_BY_STATE[state],
    principalPermissions: EXPECTED_PERMISSION_SETS_BY_STATE[state],
    permissionSetDigest: EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE[state],
  });
}

const RFC3339_UTC =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?Z$/;
const PLACEHOLDER =
  /(?:TODO|TBD|REPLACE_ME|<[^>]*>|example\.com|placeholder)/i;
const EMAIL_LOCAL_ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const APPROVAL_PRINCIPAL_KEYS = EXECUTION_PRINCIPAL_RECEIPT_FIELDS;
const EXECUTION_ACTION_KEYS = deepFreeze([
  "actualProvisioningEligible",
  "deploymentApprovalEligible",
  "publicInvokerApprovalEligible",
  "iamMutationCommandPublication",
]);

const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const SECONDS_PER_DAY = 86_400n;
const MAX_JIT_DURATION_NANOSECONDS =
  BigInt(MAX_JIT_DURATION_NANOSECONDS_DECIMAL);

export function parseExactUserPrincipal(value) {
  if (typeof value !== "string" || !value.startsWith("user:")) {
    fail("principal must use the exact user: prefix");
  }
  const email = value.slice("user:".length);
  if (email.length < 3 || email.length > 254 ||
      [...email].some((character) => character.codePointAt(0) > 0x7f)) {
    fail("principal email must be strict ASCII and at most 254 characters");
  }
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) {
    fail("principal email must contain one non-edge @");
  }
  const localPart = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (localPart.length > 64 ||
      localPart.split(".").some((atom) => !EMAIL_LOCAL_ATOM.test(atom))) {
    fail("principal local-part is not strict ASCII dot-atom");
  }
  const domainLabels = domain.split(".");
  if (domain.startsWith("[") || domain.endsWith(".") ||
      domainLabels.some((label) => !EMAIL_DOMAIN_LABEL.test(label))) {
    fail("principal domain is not a valid ASCII domain");
  }
  return deepFreeze({principal: value, email, localPart, domain});
}

function floorDiv(dividend, divisor) {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function daysFromCivil(yearInput, monthInput, dayInput) {
  let year = BigInt(yearInput);
  const month = BigInt(monthInput);
  const day = BigInt(dayInput);
  if (month <= 2n) year -= 1n;
  const era = floorDiv(year, 400n);
  const yearOfEra = year - era * 400n;
  const shiftedMonth = month + (month > 2n ? -3n : 9n);
  const dayOfYear = (153n * shiftedMonth + 2n) / 5n + day - 1n;
  const dayOfEra = yearOfEra * 365n + yearOfEra / 4n -
    yearOfEra / 100n + dayOfYear;
  return era * 146097n + dayOfEra - 719468n;
}

function maximumCalendarDay(year, month) {
  if ([4, 6, 9, 11].includes(month)) return 30;
  if (month !== 2) return 31;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return leap ? 29 : 28;
}

export function parseExactRfc3339UtcNanoseconds(value, label = "timestamp") {
  const match = typeof value === "string" ? RFC3339_UTC.exec(value) : null;
  if (!match) {
    fail(`${label} must be exact RFC3339 UTC`);
  }
  const [
    , yearText, monthText, dayText, hourText, minuteText, secondText,
    fractionalText = "",
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (day > maximumCalendarDay(year, month)) {
    fail(`${label} is not a real timestamp`);
  }
  const wholeSeconds = daysFromCivil(year, month, day) * SECONDS_PER_DAY +
    BigInt(hourText) * 3600n +
    BigInt(minuteText) * 60n +
    BigInt(secondText);
  const fractionalNanoseconds = BigInt(
      (fractionalText || "0").padEnd(9, "0"),
  );
  const epochNanoseconds =
    wholeSeconds * NANOSECONDS_PER_SECOND + fractionalNanoseconds;
  return deepFreeze({
    originalTimestamp: value,
    epochNanoseconds,
    epochNanosecondsDecimal: epochNanoseconds.toString(),
    fractionalDigitCount: fractionalText.length,
  });
}

export function compareExactRfc3339UtcInstants(left, right) {
  const leftNanoseconds =
    parseExactRfc3339UtcNanoseconds(left, "left timestamp").epochNanoseconds;
  const rightNanoseconds =
    parseExactRfc3339UtcNanoseconds(right, "right timestamp").epochNanoseconds;
  return leftNanoseconds < rightNanoseconds ?
    -1 :
    leftNanoseconds > rightNanoseconds ? 1 : 0;
}

export function exactDurationNanoseconds(start, end) {
  return parseExactRfc3339UtcNanoseconds(
      end,
      "duration end",
  ).epochNanoseconds -
    parseExactRfc3339UtcNanoseconds(
        start,
        "duration start",
    ).epochNanoseconds;
}

function timestampDigestRecord(value, label) {
  const parsed = parseExactRfc3339UtcNanoseconds(value, label);
  return {
    originalTimestamp: parsed.originalTimestamp,
    epochNanoseconds: parsed.epochNanosecondsDecimal,
    fractionalDigitCount: parsed.fractionalDigitCount,
  };
}

function approvalChronologyProjection(approval) {
  const jitStartsAt = parseExactRfc3339UtcNanoseconds(
      approval.jitStartsAt,
      "approval.jitStartsAt",
  );
  const jitExpiresAt = parseExactRfc3339UtcNanoseconds(
      approval.jitExpiresAt,
      "approval.jitExpiresAt",
  );
  return {
    profileVersion: EXACT_CHRONOLOGY_PROFILE_VERSION,
    approvedAt: timestampDigestRecord(
        approval.approvedAt,
        "approval.approvedAt",
    ),
    organizationPolicyEvidenceDigest:
      approval.organizationPolicy?.evidenceDigest,
    organizationPolicyLineageDigest:
      canonicalDigest(approval.organizationPolicyLineage),
    jitStartsAt: timestampDigestRecord(
        approval.jitStartsAt,
        "approval.jitStartsAt",
    ),
    jitExpiresAt: timestampDigestRecord(
        approval.jitExpiresAt,
        "approval.jitExpiresAt",
    ),
    jitDurationNanoseconds:
      (jitExpiresAt.epochNanoseconds -
        jitStartsAt.epochNanoseconds).toString(),
  };
}

function exactCurrentTimeNanoseconds({currentTimeMs, currentTimestamp}) {
  if (currentTimestamp !== undefined) {
    return parseExactRfc3339UtcNanoseconds(
        currentTimestamp,
        "current timestamp",
    ).epochNanoseconds;
  }
  if (!Number.isSafeInteger(currentTimeMs)) {
    fail("currentTimeMs must be a safe integer");
  }
  return BigInt(currentTimeMs) * NANOSECONDS_PER_MILLISECOND;
}

function approvalDigestProjection(approval) {
  const {approvalDigest: ignored, ...projection} = approval;
  return {
    ...projection,
    exactChronology: approvalChronologyProjection(approval),
  };
}

export function buildExecutableApprovalDigest(approval) {
  assertPlainData(approval, "approval");
  return canonicalDigest(approvalDigestProjection(approval));
}

export function buildOrganizationPolicyEvidenceDigest(evidence) {
  assertPlainData(evidence, "organization policy evidence");
  return computeOrganizationPolicyEvidenceDigest(evidence);
}

function validateServiceAccountKeyAudit(audit) {
  assertExactKeys(audit, [
    "complete",
    "projectId",
    "schemaVersion",
    "serviceAccountEmails",
    "userManagedKeyCount",
  ], "service account key audit");
  if (audit.schemaVersion !== SERVICE_ACCOUNT_KEY_AUDIT_VERSION ||
      audit.projectId !== TARGET_PROJECT_ID ||
      audit.complete !== true ||
      audit.userManagedKeyCount !== 0 ||
      !Array.isArray(audit.serviceAccountEmails) ||
      canonicalJson([...audit.serviceAccountEmails].sort()) !==
        canonicalJson(EXECUTION_SERVICE_ACCOUNT_EMAILS)) {
    fail("service account key audit must prove exact identities and zero keys");
  }
}

export function validateExecutableApproval(
    approval,
    {
      currentTimeMs = Date.now(),
      currentTimestamp,
    } = {},
) {
  assertExactKeys(approval, [
    "approvalDigest",
    "approvalId",
    "approvedAt",
    "actualProvisioningEligible",
    "deploymentApprovalEligible",
    "publicInvokerApprovalEligible",
    "iamMutationCommandPublication",
    "impersonationPrincipal",
    "invokerOperatorPrincipal",
    "jitExpiresAt",
    "jitStartsAt",
    "organizationPolicy",
    "organizationPolicyLineage",
    "provisioningPrincipal",
    "schemaVersion",
    "serviceAccountKeyAudit",
  ], "executable approval");
  if (approval.schemaVersion !== EXECUTABLE_APPROVAL_VERSION ||
      typeof approval.approvalId !== "string" ||
      approval.approvalId.length === 0 ||
      PLACEHOLDER.test(approval.approvalId) ||
      approval.approvalDigest !== buildExecutableApprovalDigest(approval)) {
    fail("approval identity or digest mismatch");
  }
  const executionPrincipals = [];
  for (const key of APPROVAL_PRINCIPAL_KEYS) {
    const member = approval[key];
    parseExactUserPrincipal(member);
    if (PLACEHOLDER.test(member)) {
      fail(`approval ${key} must be resolved by the exact receipt`);
    }
    executionPrincipals.push(member);
  }
  if (new Set(executionPrincipals).size !== executionPrincipals.length) {
    fail("approval principal roles must be distinct exact receipt users");
  }
  validateServiceAccountKeyAudit(approval.serviceAccountKeyAudit);
  const approvedAt = parseExactRfc3339UtcNanoseconds(
      approval.approvedAt,
      "approval.approvedAt",
  ).epochNanoseconds;
  const startsAt = parseExactRfc3339UtcNanoseconds(
      approval.jitStartsAt,
      "approval.jitStartsAt",
  ).epochNanoseconds;
  const expiresAt = parseExactRfc3339UtcNanoseconds(
      approval.jitExpiresAt,
      "approval.jitExpiresAt",
  ).epochNanoseconds;
  const currentTime = exactCurrentTimeNanoseconds({
    currentTimeMs,
    currentTimestamp,
  });
  if (expiresAt <= startsAt ||
      expiresAt - startsAt > MAX_JIT_DURATION_NANOSECONDS ||
      approvedAt > startsAt || currentTime < startsAt ||
      currentTime >= expiresAt) {
    fail("approval JIT window is inactive, incoherent, or longer than 2 hours");
  }
  const organizationPolicy = approval.organizationPolicy;
  const organizationPolicyResult =
    validateOrganizationPolicyEvidence(organizationPolicy);
  validateOrganizationPolicyLineageReference(
      approval.organizationPolicyLineage,
  );
  if (organizationPolicy.evidenceDigest !==
      ORGANIZATION_POLICY_EVIDENCE.evidenceDigest ||
      canonicalDigest(approval.organizationPolicyLineage) !==
        canonicalDigest(buildOrganizationPolicyLineageReference())) {
    fail("approval Organization Policy lineage is not authoritative");
  }
  if (EXECUTION_ACTION_KEYS.some((key) =>
    typeof approval[key] !== "boolean")) {
    fail("approval execution flags must be boolean");
  }
  const policyEligibility = {
    actualProvisioningEligible:
      organizationPolicyResult.provisioningPolicyCompatible,
    deploymentApprovalEligible:
      organizationPolicyResult.deploymentPolicyCompatible,
    publicInvokerApprovalEligible:
      organizationPolicyResult.publicInvokerPolicyCompatible,
    iamMutationCommandPublication:
      organizationPolicyResult.mutationCommandPublicationPolicyCompatible,
  };
  const execution = Object.fromEntries(EXECUTION_ACTION_KEYS.map((key) => [
    key,
    policyEligibility[key] && approval[key] === true,
  ]));
  if (EXECUTION_ACTION_KEYS.some((key) => approval[key] !== execution[key])) {
    fail("approval execution flags do not fail closed for Organization Policy");
  }
  return deepFreeze({
    approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest,
    provisioningPrincipal: approval.provisioningPrincipal,
    impersonationPrincipal: approval.impersonationPrincipal,
    invokerOperatorPrincipal: approval.invokerOperatorPrincipal,
    jitActive: true,
    jitStartsAt: approval.jitStartsAt,
    jitExpiresAt: approval.jitExpiresAt,
    organizationPolicyStatus: organizationPolicy.observationStatus,
    organizationPolicyEvidenceDigest: organizationPolicy.evidenceDigest,
    userManagedServiceAccountKeyCount:
      approval.serviceAccountKeyAudit.userManagedKeyCount,
    execution,
    executable: EXECUTION_ACTION_KEYS.every((key) => execution[key]),
  });
}

export const validatePrincipalJitOrgPolicyApproval =
  validateExecutableApproval;

function validateReceiptApprovalBinding(receipt, approval) {
  const assessment = validateExecutableApproval(approval, {
    currentTimestamp: receipt.observedAt,
  });
  validateOrganizationPolicyLineageReference(
      receipt.organizationPolicyLineage,
  );
  if (receipt.approvalId !== assessment.approvalId ||
      receipt.approvalDigest !== assessment.approvalDigest ||
      canonicalDigest(receipt.organizationPolicyLineage) !==
        canonicalDigest(approval.organizationPolicyLineage)) {
    fail("receipt is not bound to an active executable approval");
  }
  return assessment;
}

const TRANSITION_RECEIPT_KEYS = deepFreeze([
  "after",
  "approvalDigest",
  "approvalId",
  "before",
  "contractDigest",
  "exactChronologyDigest",
  "fromState",
  "observedAt",
  "organizationPolicyLineage",
  "schemaVersion",
  "toState",
]);

export function validateFreezeActivationReceipt(receipt, approval) {
  assertExactKeys(receipt, TRANSITION_RECEIPT_KEYS,
      "freeze activation receipt");
  if (receipt.schemaVersion !== FREEZE_ACTIVATION_RECEIPT_VERSION ||
      receipt.contractDigest !== PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST ||
      receipt.fromState !== STEADY_STATE ||
      receipt.toState !== FREEZE_ACTIVE_STATE ||
      receipt.exactChronologyDigest !==
        buildTransitionReceiptChronologyDigest(receipt, approval)) {
    fail("freeze activation transition identity mismatch");
  }
  const approvalAssessment = validateReceiptApprovalBinding(receipt, approval);
  validateStateSnapshot(receipt.before, STEADY_STATE);
  validateStateSnapshot(receipt.after, FREEZE_ACTIVE_STATE);
  if (!receipt.before.principalPermissions.find(({member}) =>
    member === WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER)?.permissions
      .includes("datastore.entities.create") ||
      receipt.after.principalPermissions.find(({member}) =>
        member === WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER)?.permissions
          .some((permission) =>
            WRITABLE_DATASTORE_PERMISSIONS.includes(permission)) ||
      receipt.before.bindingSetDigest === receipt.after.bindingSetDigest ||
      receipt.before.permissionSetDigest === receipt.after.permissionSetDigest) {
    fail("freeze activation does not prove writer replacement");
  }
  return approvalAssessment.executable;
}

export const validateActivationReceipt = validateFreezeActivationReceipt;

const RESTORATION_CHRONOLOGY_KEYS = deepFreeze([
  "iamRestoredAt",
  "positiveSmokeAt",
  "schedulerRestoredAt",
  "sentinelDeactivatedAt",
]);

function transitionChronologyProjection(receipt, approval) {
  const chronology = Object.hasOwn(receipt, "chronology") ?
    Object.fromEntries(RESTORATION_CHRONOLOGY_KEYS.map((key) => [
      key,
      timestampDigestRecord(
          receipt.chronology?.[key],
          `receipt.chronology.${key}`,
      ),
    ])) :
    null;
  return {
    profileVersion: EXACT_CHRONOLOGY_PROFILE_VERSION,
    approval: approvalChronologyProjection(approval),
    receiptObservedAt: timestampDigestRecord(
        receipt.observedAt,
        "receipt.observedAt",
    ),
    chronology,
  };
}

export function buildTransitionReceiptChronologyDigest(receipt, approval) {
  return canonicalDigest(transitionChronologyProjection(receipt, approval));
}

export function validateUnfreezeRestorationReceipt(receipt, approval) {
  assertExactKeys(receipt, [
    ...TRANSITION_RECEIPT_KEYS,
    "chronology",
  ], "unfreeze restoration receipt");
  if (receipt.schemaVersion !== UNFREEZE_RESTORATION_RECEIPT_VERSION ||
      receipt.contractDigest !== PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST ||
      receipt.fromState !== FREEZE_ACTIVE_STATE ||
      receipt.toState !== STEADY_STATE) {
    fail("unfreeze restoration transition identity mismatch");
  }
  const approvalAssessment =
    validateReceiptApprovalBinding(receipt, approval);
  validateStateSnapshot(receipt.before, FREEZE_ACTIVE_STATE);
  validateStateSnapshot(receipt.after, STEADY_STATE);
  assertExactKeys(
      receipt.chronology,
      RESTORATION_CHRONOLOGY_KEYS,
      "unfreeze chronology",
  );
  if (receipt.exactChronologyDigest !==
      buildTransitionReceiptChronologyDigest(receipt, approval)) {
    fail("unfreeze restoration exact chronology digest mismatch");
  }
  const times = RESTORATION_CHRONOLOGY_KEYS.map((key) =>
    parseExactRfc3339UtcNanoseconds(
        receipt.chronology[key],
        `unfreeze chronology.${key}`,
    ).epochNanoseconds);
  const observedAt = parseExactRfc3339UtcNanoseconds(
      receipt.observedAt,
      "receipt.observedAt",
  ).epochNanoseconds;
  const jitStartsAt = parseExactRfc3339UtcNanoseconds(
      approvalAssessment.jitStartsAt,
      "approval.jitStartsAt",
  ).epochNanoseconds;
  const jitExpiresAt = parseExactRfc3339UtcNanoseconds(
      approvalAssessment.jitExpiresAt,
      "approval.jitExpiresAt",
  ).epochNanoseconds;
  if (!(jitStartsAt <= times[0] &&
      times[0] <= times[2] &&
      times[2] <= times[3] &&
      times[3] <= times[1] &&
      times[1] <= observedAt &&
      observedAt < jitExpiresAt)) {
    fail(
        "IAM restoration must precede scheduler, sentinel, smoke, and " +
        "observation and remain inside JIT",
    );
  }
  return approvalAssessment.executable;
}

export const validateRestorationReceipt =
  validateUnfreezeRestorationReceipt;
export const validateRuntimeIamStateSnapshot = validateStateSnapshot;
export const computeCanonicalSetDigest = buildCanonicalSetDigest;
export const computeBindingSetDigest = buildBindingSetDigest;
export const computePermissionSetDigest = buildPermissionSetDigest;
export const WRITER_SERVICE_ACCOUNT_EMAIL =
  WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL;
export const PREVIEW_SERVICE_ACCOUNT_EMAIL =
  PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL;

validatePrivateRuntimeIamContract();
