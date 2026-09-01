import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildFixedPrivateAssignmentCallablePayload,
  canCommitFixedPrivateAssignmentBackfill,
  classifyFixedPrivateAssignmentDates,
  formatFixedPrivateAssignmentBackfillWarning,
  isPastFixedPrivateAssignmentDate,
} from "../src/features/dashboard/privateFixedAssignmentBackfill.js";

const dashboardSource = fs.readFileSync(
    path.join(process.cwd(), "Dashboard.jsx"),
    "utf8",
);
const sectionSource = fs.readFileSync(
    path.join(
        process.cwd(),
        "src/features/dashboard/sections/PrivateLessonSlotsSection.jsx",
    ),
    "utf8",
);

test("KST canonical dates classify past rows without UTC date parsing", () => {
  const classification = classifyFixedPrivateAssignmentDates(
      ["2026-08-11", "2026-08-12", "2026-08-13"],
      "2026-08-12",
  );
  assert.deepEqual(classification.pastDates, ["2026-08-11"]);
  assert.equal(classification.pastDateCount, 1);
  assert.equal(isPastFixedPrivateAssignmentDate("2026-08-11", "2026-08-12"), true);
  assert.equal(isPastFixedPrivateAssignmentDate("2026-08-12", "2026-08-12"), false);
});

test("past preview warning includes count and each past row has marker", () => {
  assert.equal(
      formatFixedPrivateAssignmentBackfillWarning(2),
      "과거 일정 2회가 포함되어 있습니다. 누락된 수업을 보정하는 경우에만 배정하세요.",
  );
  assert.match(sectionSource, /private-fixed-assignment-backfill-warning/);
  assert.match(sectionSource, /private-fixed-assignment-backfill-marker/);
  assert.match(sectionSource, /누락 보정/);
});

test("past dates no longer hard-block preview and preview calls read-only mode", () => {
  assert.doesNotMatch(
      dashboardSource,
      /과거 날짜에는 고정 1:1 수업을 생성할 수 없습니다/,
  );
  const previewStart = dashboardSource.indexOf(
      "async function previewPrivateFixedSlotAssignment()",
  );
  const commitStart = dashboardSource.indexOf(
      "async function createPrivateFixedSlotAssignment(",
      previewStart,
  );
  assert.ok(previewStart >= 0);
  assert.ok(commitStart > previewStart);
  const previewSource = dashboardSource.slice(previewStart, commitStart);
  assert.match(previewSource, /previewOnly: true/);
  assert.match(previewSource, /pastDateCount: plan\.pastDateCount/);
  assert.match(previewSource, /createFixedPrivateLessonAssignment/);
});

test("past commit is blocked until the explicit checkbox confirmation", () => {
  assert.equal(canCommitFixedPrivateAssignmentBackfill(1, false), false);
  assert.equal(canCommitFixedPrivateAssignmentBackfill(1, true), true);
  assert.equal(canCommitFixedPrivateAssignmentBackfill(0, false), true);
  assert.match(sectionSource, /private-fixed-assignment-backfill-checkbox/);
  assert.match(
      dashboardSource,
      /canCommitFixedPrivateAssignmentBackfill\(plan\.pastDateCount, backfillConfirmed\)/,
  );
});

test("past preview and confirmed commit payloads send allowPastDates true", () => {
  const base = {
    academyId: "demo-academy",
    requestId: "request-backfill",
    assignableDates: ["2026-08-11"],
  };
  assert.deepEqual(
      buildFixedPrivateAssignmentCallablePayload(
          base,
          {previewOnly: true, pastDateCount: 1},
      ),
      {
        ...base,
        commit: false,
        dryRun: true,
        previewOnly: true,
        allowPastDates: true,
      },
  );
  assert.deepEqual(
      buildFixedPrivateAssignmentCallablePayload(base, {pastDateCount: 1}),
      {
        ...base,
        commit: true,
        dryRun: false,
        previewOnly: false,
        allowPastDates: true,
      },
  );
});

test("future-only payload preserves legacy shape and omits allowPastDates", () => {
  const base = {
    academyId: "demo-academy",
    requestId: "request-future",
    assignableDates: ["2026-08-13"],
  };
  const payload = buildFixedPrivateAssignmentCallablePayload(base);
  assert.deepEqual(payload, {
    ...base,
    commit: true,
    dryRun: false,
    previewOnly: false,
  });
  assert.equal(Object.hasOwn(payload, "allowPastDates"), false);
});
