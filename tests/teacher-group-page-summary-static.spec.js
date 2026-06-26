import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('teacher group page hides today schedule summary cards in source wiring', () => {
  const dashboardSource = readFileSync('Dashboard.jsx', 'utf8');
  const todaySchedulePanelSource = readFileSync(
    'src/features/dashboard/components/TodaySchedulePanel.jsx',
    'utf8'
  );

  expect(todaySchedulePanelSource).toContain("summaryVariant === 'hidden'");
  expect(todaySchedulePanelSource).toContain('const summaryItems = (hideSummary');
  expect(dashboardSource).toContain("activeSection === 'groups' && !isAdmin");
  expect(dashboardSource).toContain("? 'hidden'");
  expect(dashboardSource).toContain(": 'teacherPrivate'");
});
