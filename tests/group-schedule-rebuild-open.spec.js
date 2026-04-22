import { test, expect } from '@playwright/test';
import {
  getGroupRow,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_GROUP_NAME,
} from './fixtures/test-data.js';

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

test('관리자가 그룹 수정 후 이후 일정 재생성 모달을 열고 기본값을 확인할 수 있다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const rebuildFromDate = formatYmd(addDays(new Date(), 680));
  const uniqueToken = Date.now();

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '반 관리');

  const groupRow = getGroupRow(page, TEST_GROUP_NAME);
  await expect(groupRow).toBeVisible();

  const editButton = groupRow.getByRole('button', { name: '수정', exact: true });
  await expect(editButton).toBeVisible();

  async function openGroupEditDialog() {
    await editButton.click();
    const dialog = page.getByRole('dialog', { name: '반 수정' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('반 이름')).toHaveValue(TEST_GROUP_NAME);
    return dialog;
  }

  async function saveGroupEditDialog(dialog) {
    const saveButton = dialog.getByRole('button', { name: '저장', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(dialog).toBeHidden();
  }

  const initialDialog = await openGroupEditDialog();
  const subjectInput = initialDialog.getByLabel('과목');
  await expect(subjectInput).toBeVisible();

  const originalSubject = await subjectInput.inputValue();
  const updatedSubject = `${originalSubject} E2E-${uniqueToken}`.trim();

  await initialDialog.getByLabel('이 날짜부터 이후 수업도 함께 변경').check();
  await initialDialog.getByLabel('변경 적용 시작일').fill(rebuildFromDate);
  await subjectInput.fill(updatedSubject);
  await saveGroupEditDialog(initialDialog);

  let groupUpdated = true;

  try {
    const rebuildDialog = page.getByRole('dialog', {
      name: '해당 날짜부터 이후 수업을 다시 만들까요?',
    });
    await expect(rebuildDialog).toBeVisible();
    await expect(rebuildDialog).toContainText(TEST_GROUP_NAME);
    await expect(rebuildDialog.getByLabel('다시 생성 시작일')).toHaveValue(rebuildFromDate);
    await expect(rebuildDialog).toContainText(`입력한 기준 날짜: ${rebuildFromDate}`);
    await expect(rebuildDialog).toContainText(`실제 적용 기준일: ${rebuildFromDate}`);
    await expect(rebuildDialog).toContainText(updatedSubject);

    await rebuildDialog.getByRole('button', { name: '그대로 유지', exact: true }).click();
    await expect(rebuildDialog).toBeHidden();
  } finally {
    const rebuildDialog = page.getByRole('dialog', {
      name: '해당 날짜부터 이후 수업을 다시 만들까요?',
    });
    if (await rebuildDialog.count()) {
      if (await rebuildDialog.isVisible()) {
        await rebuildDialog.getByRole('button', { name: '그대로 유지', exact: true }).click();
        await expect(rebuildDialog).toBeHidden();
      }
    }

    if (!groupUpdated) return;

    const restoreDialog = await openGroupEditDialog();
    await restoreDialog.getByLabel('과목').fill(originalSubject);
    await saveGroupEditDialog(restoreDialog);

    const maybeRebuildDialog = page.getByRole('dialog', {
      name: '해당 날짜부터 이후 수업을 다시 만들까요?',
    });
    if (await maybeRebuildDialog.count()) {
      if (await maybeRebuildDialog.isVisible()) {
        await maybeRebuildDialog.getByRole('button', { name: '그대로 유지', exact: true }).click();
        await expect(maybeRebuildDialog).toBeHidden();
      }
    }
  }
});
