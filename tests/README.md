# Playwright Test Suite

현재 Playwright 스위트는 관리자/선생님 주요 운영 흐름을 Chromium 기준으로 검증합니다.

## Test Files

- `tests/student-add-open.spec.js`: 관리자가 학생 추가 모달을 열 수 있는지 검증합니다.
- `tests/student-add-save.spec.js`: 관리자가 학생을 실제로 저장하고 학생 목록에서 바로 검색되는지 검증합니다.
- `tests/private-package-add.spec.js`: 관리자가 기존 학생에게 개인 수강권을 추가하고 후속 예약 안내 모달이 뜨는지 검증합니다.
- `tests/group-package-add.spec.js`: 관리자가 기존 학생에게 그룹 수강권을 추가하고 후속 반 등록 안내 모달이 뜨는지 검증합니다.
- `tests/group-post-enroll-confirm.spec.js`: 그룹 수강권 생성 후 후속 모달에서 즉시 반 등록까지 완료되는지 검증합니다.
- `tests/group-schedule-create.spec.js`: 특정 그룹에 미래 일정 범위를 실제로 생성하고 해당 날짜 범위의 수업이 생기는지 검증합니다.
- `tests/group-attendance-open.spec.js`: 특정 그룹 상세에서 출결/차감 모달이 열리고 기본 내용이 보이는지 검증합니다.
- `tests/calendar-group-row-open.spec.js`: 캘린더의 그룹 수업 row를 눌렀을 때 출결/차감 모달이 열리는지 검증합니다.
- `tests/teacher-permission.spec.js`: teacher 계정이 관리자보다 제한된 UI를 보고 본인 담당 데이터 범위만 접근하는지 검증합니다.
- `tests/group-lesson-create.spec.js`: 예전 미래 일정 확인 테스트이며 현재는 더 안정적인 `group-schedule-create.spec.js`로 대체되었습니다.
- `tests/example.spec.js`: Playwright 기본 예제 파일이며 운영 앱 테스트와 무관해 기본 실행에서는 skip됩니다.

## Shared Test Data

공통 테스트 데이터는 `tests/fixtures/test-data.js`에 있습니다.

- `ADMIN_EMAIL`: `test-admin@miami.com`
- `ADMIN_PASSWORD`: `12345678`
- `TEST_TEACHER_EMAIL`: `test-teacher@miami.com`
- `TEST_TEACHER_PASSWORD`: `12345678`
- `TEST_GROUP_NAME`: `고급영어회화`
- `TEST_STUDENT_NAME`: `이나규미`

테스트가 안정적으로 통과하려면 위 계정과 데이터가 Firestore/앱 상태에 실제로 존재해야 합니다.

## Run

```bash
source "$HOME/.nvm/nvm.sh"
nvm use
npm run test:e2e:chromium
```

필요에 따라 아래 명령도 사용할 수 있습니다.

```bash
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:report
```

## Skips

- `tests/group-lesson-create.spec.js`: `test.skip(true, 'group-schedule-create.spec.js로 대체된 중복 테스트입니다.')`로 항상 skip됩니다. 기존 역할이 `tests/group-schedule-create.spec.js`의 더 안정적인 범위 기반 검증으로 대체되었기 때문입니다.
- `tests/example.spec.js`: Playwright가 생성한 기본 예제라 운영 앱 검증과 무관하며 외부 사이트(`playwright.dev`)에 의존하므로 기본 실행에서 `test.skip()` 처리했습니다.
- 여러 앱 스펙은 공통적으로 `browserName !== 'chromium'`일 때 skip됩니다. 현재 스위트는 Chromium 기준으로 작성되어 있어 실행 명령도 `--project=chromium`을 사용합니다.
