import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
    new URL("../Dashboard.jsx", import.meta.url),
    "utf8",
);
const sectionSource = readFileSync(
    new URL(
        "../src/features/dashboard/sections/PrivateLessonSlotsSection.jsx",
        import.meta.url,
    ),
    "utf8",
);
const functionSource = readFileSync(
    new URL("../functions/index.js", import.meta.url),
    "utf8",
);

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function skipTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index + 2);
      return newline === -1 ? source.length : skipTrivia(source, newline + 1);
    }
    if (source.startsWith("/*", index)) {
      const commentEnd = source.indexOf("*/", index + 2);
      assert.notEqual(commentEnd, -1, "unterminated block comment");
      index = commentEnd + 2;
      continue;
    }
    break;
  }
  return index;
}

function matchingDelimiterIndex(source, openIndex) {
  const matchingClose = {"(": ")", "[": "]", "{": "}"};
  assert.ok(matchingClose[source[openIndex]], "expected opening delimiter");
  const stack = [source[openIndex]];
  let mode = "code";

  for (let index = openIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (mode === "template") {
      if (char === "\\") {
        index += 1;
      } else if (char === "`") {
        mode = "code";
      } else if (char === "$" && source[index + 1] === "{") {
        stack.push("${");
        mode = "code";
        index += 1;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      const quote = char;
      for (index += 1; index < source.length; index += 1) {
        if (source[index] === "\\") {
          index += 1;
        } else if (source[index] === quote) {
          break;
        }
      }
      assert.ok(index < source.length, "unterminated quoted string");
      continue;
    }
    if (char === "`") {
      mode = "template";
      continue;
    }
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index + 2);
      if (newline === -1) break;
      index = newline;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const commentEnd = source.indexOf("*/", index + 2);
      assert.notEqual(commentEnd, -1, "unterminated block comment");
      index = commentEnd + 1;
      continue;
    }
    if (matchingClose[char]) {
      stack.push(char);
      continue;
    }
    const top = stack.at(-1);
    if (char === "}" && top === "${") {
      stack.pop();
      mode = "template";
      continue;
    }
    if (char === matchingClose[top]) {
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  assert.fail("unterminated balanced delimiter");
}

function functionDeclaration(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function: ${name}`);
  const parametersStart = source.indexOf("(", start);
  const parametersEnd = matchingDelimiterIndex(source, parametersStart);
  let bodyStart = skipTrivia(source, parametersEnd + 1);
  if (source.startsWith("=>", bodyStart)) {
    bodyStart = skipTrivia(source, bodyStart + 2);
  }
  assert.equal(source[bodyStart], "{", `missing function body: ${name}`);
  const bodyEnd = matchingDelimiterIndex(source, bodyStart);
  return source.slice(start, bodyEnd + 1);
}

const sectionFixedPredicate = new Function(
    `${functionDeclaration(sectionSource, "isTemplateForFixedAssignment")}
     return isTemplateForFixedAssignment;`,
)();
const dashboardFixedPredicate = new Function(
    `${functionDeclaration(
        dashboardSource,
        "isPrivateAvailabilityTemplateForFixedAssignment",
    )}
     return isPrivateAvailabilityTemplateForFixedAssignment;`,
)();
const templateUsageLabel = new Function(
    `${functionDeclaration(sectionSource, "isTemplateForFixedAssignment")}
     ${functionDeclaration(sectionSource, "isTemplateOpenForStudentBooking")}
     ${functionDeclaration(sectionSource, "getTemplateUsageLabel")}
     return getTemplateUsageLabel;`,
)();
const templateUsagePatch = new Function(
    `${functionDeclaration(
        dashboardSource,
        "getPrivateAvailabilityTemplateUsagePatch",
    )}
     return getPrivateAvailabilityTemplateUsagePatch;`,
)();

test("F01 true shows fixed label, is selectable, and preview/commit use the same templateId", () => {
  assert.equal(sectionFixedPredicate({useForFixedAssignment: true}), true);
  assert.equal(dashboardFixedPredicate({useForFixedAssignment: true}), true);
  assert.equal(
      templateUsageLabel({useForFixedAssignment: true}),
      "고정 수업 배정용",
  );

  const optionsBlock = sourceBlock(
      sectionSource,
      "const privateFixedAssignmentTemplateOptions = useMemo(() =>",
      "const privateWeeklyTemplateTodayYmd",
  );
  assert.match(optionsBlock, /\.filter\(isTemplateForFixedAssignment\)/);

  const previewBlock = sourceBlock(
      dashboardSource,
      "async function previewPrivateFixedSlotAssignment()",
      "async function createPrivateFixedSlotAssignment(",
  );
  const commitBlock = sourceBlock(
      dashboardSource,
      "async function createPrivateFixedSlotAssignment(",
      "async function createPrivateAvailabilityTemplate()",
  );
  const canonicalTemplateId = /templateId: String\(plan\.template\?\.id \|\| ''\)\.trim\(\)/;
  assert.match(previewBlock, canonicalTemplateId);
  assert.match(commitBlock, canonicalTemplateId);
});

test("F02 false is not labeled fixed and is excluded from fixed assignment selection", () => {
  assert.equal(sectionFixedPredicate({useForFixedAssignment: false}), false);
  assert.equal(dashboardFixedPredicate({useForFixedAssignment: false}), false);
  assert.equal(
      templateUsageLabel({useForFixedAssignment: false}),
      "용도 없음",
  );
});

test("F03 missing or null is marked settings-required and cannot be previewed or committed", () => {
  for (const template of [{}, {useForFixedAssignment: null}]) {
    assert.equal(sectionFixedPredicate(template), false);
    assert.equal(dashboardFixedPredicate(template), false);
    assert.equal(templateUsageLabel(template), "고정 배정 설정 필요");
  }
  const planBlock = sourceBlock(
      dashboardSource,
      "function buildPrivateFixedSlotAssignmentPlan()",
      "function buildPrivateFixedSlotAssignmentPreviewState(",
  );
  assert.match(
      planBlock,
      /if \(template && !isPrivateAvailabilityTemplateForFixedAssignment\(template\)\)/,
  );
  assert.match(planBlock, /errors\.templateId = '고정 배정에 사용하는 주간 가능 시간을 선택해 주세요'/);
});

test("F04 legacy edit starts checked and save normalizes the field to explicit true", () => {
  const editOpenBlock = sourceBlock(
      sectionSource,
      "function openAvailabilityTemplateEdit(template)",
      "async function saveAvailabilityTemplateEdit(template)",
  );
  assert.match(
      editOpenBlock,
      /useForFixedAssignment: template\?\.useForFixedAssignment !== false/,
  );
  assert.deepEqual(
      templateUsagePatch({
        useForFixedAssignment: true,
        openForStudentBooking: false,
        currentTemplate: {},
      }),
      {useForFixedAssignment: true},
  );
});

test("F05 checked create writes an explicit true field", () => {
  const createBlock = sourceBlock(
      dashboardSource,
      "async function createPrivateAvailabilityTemplate()",
      "async function updatePrivateAvailabilityTemplateStatus(",
  );
  assert.match(
      createBlock,
      /addDoc\(collection\(db, 'privateLessonAvailabilityTemplates'\)/,
  );
  assert.match(
      createBlock,
      /getPrivateAvailabilityTemplateUsagePatch\(\{\s*useForFixedAssignment,/,
  );
  assert.deepEqual(
      templateUsagePatch({
        useForFixedAssignment: true,
        openForStudentBooking: false,
      }),
      {useForFixedAssignment: true},
  );
});

test("F06 unchecked create and update write explicit false without omission", () => {
  assert.deepEqual(
      templateUsagePatch({
        useForFixedAssignment: false,
        openForStudentBooking: false,
      }),
      {useForFixedAssignment: false},
  );
  assert.deepEqual(
      templateUsagePatch({
        useForFixedAssignment: false,
        openForStudentBooking: false,
        currentTemplate: {useForFixedAssignment: true},
      }),
      {useForFixedAssignment: false},
  );
  assert.equal(
      Object.hasOwn(
          templateUsagePatch({
            useForFixedAssignment: false,
            openForStudentBooking: false,
          }),
          "useForFixedAssignment",
      ),
      true,
  );
});

test("F07 canonical payloads retain teacher, schedule, status, and date-range fields", () => {
  const createBlock = sourceBlock(
      dashboardSource,
      "async function createPrivateAvailabilityTemplate()",
      "async function updatePrivateAvailabilityTemplateStatus(",
  );
  for (const field of [
    "teacher: teacherFields.teacher",
    "teacherName: teacherFields.teacherName",
    "weekday,",
    "time,",
    "durationMinutes,",
    "effectiveStartDate",
    "effectiveEndDate",
    "status,",
  ]) {
    assert.match(createBlock, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const updateBlock = sourceBlock(
      dashboardSource,
      "async function updatePrivateAvailabilityTemplateDetails(template, values)",
      "async function updatePrivateSlotEligibility(",
  );
  assert.match(updateBlock, /status,/);
  assert.match(updateBlock, /effectiveStartDate:/);
  assert.match(updateBlock, /effectiveEndDate:/);
});

test("F08 save and assignment stay on canonical Firestore/callable paths without bypass", () => {
  const saveBlock = sourceBlock(
      dashboardSource,
      "async function createPrivateAvailabilityTemplate()",
      "async function updatePrivateSlotEligibility(",
  );
  assert.match(
      saveBlock,
      /addDoc\(collection\(db, 'privateLessonAvailabilityTemplates'\)/,
  );
  assert.match(
      saveBlock,
      /updateDoc\(doc\(db, 'privateLessonAvailabilityTemplates', template\.id\)/,
  );

  const assignmentBlock = sourceBlock(
      dashboardSource,
      "async function previewPrivateFixedSlotAssignment()",
      "async function createPrivateAvailabilityTemplate()",
  );
  assert.equal(
      assignmentBlock.match(
          /httpsCallable\(firebaseFunctions, 'createFixedPrivateLessonAssignment'\)/g,
      )?.length,
      2,
  );
  assert.doesNotMatch(assignmentBlock, /\b(addDoc|setDoc|updateDoc|writeBatch)\s*\(/);
  assert.match(functionSource, /template\.useForFixedAssignment !== true/);
});
