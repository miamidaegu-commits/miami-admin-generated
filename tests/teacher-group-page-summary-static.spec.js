import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('teacher group page hides today schedule summary cards in source wiring', () => {
  const dashboardSource = readFileSync('Dashboard.jsx', 'utf8');
  const todaySchedulePanelSource = readFileSync(
    'src/features/dashboard/components/TodaySchedulePanel.jsx',
    'utf8'
  );

  assert.match(todaySchedulePanelSource, /summaryVariant === 'hidden'/);
  assert.match(todaySchedulePanelSource, /const summaryItems = \(hideSummary/);
  assert.match(dashboardSource, /activeSection === 'groups' && !isAdmin/);
  assert.match(dashboardSource, /\? 'hidden'/);
  assert.match(dashboardSource, /: 'teacherPrivate'/);
});
