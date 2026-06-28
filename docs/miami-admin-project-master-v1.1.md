# Miami Admin 프로젝트 마스터 문서 v1.1

- 기준일: 2026-06-28
- 기준 HEAD: `0a5ff10 Prevent production hosting deploys without Firebase env (#118)`
- 목적: 앞으로 Codex/Agent 작업을 지휘할 때 기준으로 삼는 운영, 배포, 테스트, 보호 대상 문서
- 범위: private 1:1, 개인 수강권, group/openGroup, 단체반 수강권, 학생 예약 화면, 선생님 화면, 배포/운영 안전장치

## 1. 프로젝트 현재 기준

- main branch: `product-version`
- main worktree: `/Users/mike1choi/Desktop/miami-admin-weekly-slot-fixed-private-assignment`
- 보조 worktree: `/Users/mike1choi/Projects/miami-admin-worktrees/<branch-name>`
- frontend: Vite + React
- backend/functions: Firebase Cloud Functions, `functions/index.js`
- DB/Auth: Firestore + Firebase Auth
- Hosting project: `miamiacademyschedule`
- Functions project: `daegu-miami-production`
- E2E project: `miami-e2e`

## 2. 핵심 도메인

- 개인 1:1 수업
- 개인 수강권
- 단체반
- 단체반 수강권
- 단체반 예약/등록
- 선생님 읽기 전용/관리 화면
- 학생 예약 화면
- 배포/운영 안전장치

## 3. v1.0 이후 완료된 PR

- #112 Polish group package open booking UI labels
- #113 Add group ticket free booking permission
- #114 Harden group ticket booking permission logic
- #115 Polish group booking availability UI
- #116 Polish group admin package follow-up flows
- #117 Add group booking cancel limit policy
- #118 Prevent production hosting deploys without Firebase env

## 4. Private 1:1 현재 설계 요약

Private 1:1은 이중 모델이다.

- 고정 1:1 / 레거시 고정 수업: `lessons` 기반
- 학생 직접 예약: `privateLessonSlots` + `privateLessonReservations` 기반
- 두 모델은 `studentPackages`, `studentPrivateAccessSummary`, `creditTransactions`, cancel allowance, 차감/복구 정책으로 연결된다.

## 5. Private 1:1 수강권 구조

- 기본 저장소: `studentPackages`
- `packageType`: `private`

주요 필드:

- `teacher`
- `teacherKey`
- `teacherUid`
- `teacherName`
- `teacherDisplayName`
- `totalCount`
- `usedCount`
- `remainingCount`
- `status`
- `privatePackageMode`

`privatePackageMode`:

- `regular`: 주당 횟수/기간 기반 정기 수강권
- `countBased`: 총 횟수 직접 입력 수강권

Teacher scope matching:

- package teacher key와 slot/reservation teacher key가 맞아야 예약/차감 후보가 된다.
- `teacherKey`/`teacherUid`/`teacherName`/`displayName` scope matching은 보호 대상이다.

## 6. Private 1:1 생성/수정/top-up/종료 흐름

관련 파일:

- `src/features/dashboard/modals/StudentPackageModal.jsx`
- `src/features/dashboard/modals/StudentPackageEditModal.jsx`
- `src/features/dashboard/hooks/useStudentPackageFlow.js`
- `src/features/dashboard/hooks/useStudentPackageAdminFlow.js`
- `src/features/dashboard/hooks/usePrivateLessonFlow.js`

생성:

- `StudentPackageModal`에서 개인 수강권 선생님과 모드를 선택한다.
- `useStudentPackageFlow`가 `studentPackages` 생성, `creditTransactions` 기록, `studentPrivateAccessSummary`의 `teacherKeys`/`activePackageIds`를 갱신한다.

Top-up:

- 같은 선생님 active private package가 있으면 기본적으로 기존 수강권에 추가 등록한다.
- `totalCount`, `remainingCount`, `topUpCount` 계열을 갱신한다.
- `creditTransactions`에 `private_package_top_up` 기록을 남긴다.
- 다른 선생님 scope는 분리해야 한다.

수정/종료/회수:

- `useStudentPackageAdminFlow` 중심이다.
- 미래 예약/고정 배정이 있으면 private 회수는 차단될 수 있다.
- 종료/회수 시 `studentPrivateAccessSummary`에서 package/teacher access를 제거한다.
- private top-up/차감/복구 로직과 얽혀 있으므로 보호 대상이다.

## 7. 학생 Private 1:1 예약 흐름

관련 파일:

- `StudentBookingPage.jsx`
- `src/features/private-booking/studentPrivateAccessSummaryClient.js`
- `src/features/private-booking/privateBookingModel.js`
- `src/features/booking/privateBookingWindow.js`
- `src/features/booking/studentPrivateCancelAllowance.js`

권한/목록:

- `studentPrivateAccessSummary`, `studentPackages`, `privateStudents`를 읽는다.
- callable `listPrivateLessonSlotAvailability`로 예약 가능/바쁨/내 예약/고정 공개 슬롯을 계산한다.

예약:

- callable `reservePrivateLessonSlot` 사용.
- `privateLessonSlots`를 `reserved`로 바꾸고 `privateLessonReservations`를 생성한다.
- 예약 시점에는 수강권을 차감하지 않는다.
- package linkage만 저장한다.

취소:

- callable `cancelPrivateLessonReservation` 사용.
- 학생 취소는 수업 시작 6시간 전까지만 가능하다.
- `studentPrivateBookingStats.studentCancelCount` 증가.
- fixed/released slot이면 다시 `open`/`released_fixed`로 공개될 수 있다.

잔여 횟수:

- 예약 시점 차감이 아니라 완료/노쇼/자동 차감 시 반영한다.

## 8. 관리자 Private 1:1 예약 시간 관리

관련 UI:

- `src/features/dashboard/sections/PrivateLessonSlotsSection.jsx`
- `src/features/dashboard/hooks/usePrivateLessonFlow.js`

관리 항목:

- 단건 1:1 slot 생성
- 반복 주간 slot 생성
- `privateLessonAvailabilityTemplates` 기반 주간 기본 시간표
- 고정 배정: 주간 시간에 학생 고정 배정
- slot eligibility 편집
- 예약 취소
- 선생님 수업불가로 닫기
- 다시 열기

관련 callable:

- `adminClosePrivateLessonSlot`
- `adminReopenPrivateLessonSlot`
- `adminCancelPrivateLessonReservation`
- `cancelFixedPrivateLessonOccurrence`

## 9. 선생님 Private 1:1 화면/통계

관련 개념:

- `privateLessonReservations`
- `lessons`
- `privateLessonSlots`

관련 파일/컴포넌트:

- `src/features/dashboard/teacherLessonRosterHelpers.js`
- `src/features/dashboard/modals/TeacherLessonRosterModal.jsx`
- `src/features/dashboard/components/LessonCountStatsPanel.jsx`
- `src/features/dashboard/sections/TeacherPrivateLessonRequestsSection.jsx`

흐름:

- 선생님은 주로 자기 일정/학생 roster를 확인한다.
- 완료/노쇼 처리 시 `markPrivateReservationOutcome`으로 private 수강권 차감.
- 완료/노쇼 처리 취소 시 `reversePrivateReservationOutcome`으로 수강권 복구.
- 단체반 화면에서는 1:1 통계가 숨겨지고, 내 주간 1:1 시간표에서는 1:1 통계가 유지된다.

확인 필요:

- `TeacherPrivateLessonRequestsSection`의 실제 운영 navigation 연결 범위.

## 10. Private 1:1 Firestore 구조

주요 컬렉션:

- `privateStudents`
  - 개인 1:1 학생 프로필/소속 academy/담당 선생님 정보
- `studentPackages`
  - private/group/openGroup 수강권 공통 저장소
  - private는 `packageType: private`
- `studentPrivateAccessSummary`
  - 문서 키: `{academyId}__{studentId}`
  - `teacherKeys`
  - `activePackageIds`
  - `allowedSlotIds`
  - `allowedPrivateLessonSlotIds`
  - `privateSlotBookingPilotEnabled`
- `privateLessonSlots`
  - 실제/생성/공개/닫힘 1:1 예약 시간
- `privateLessonAvailabilityTemplates`
  - 주간 기본 1:1 시간표
- `privateLessonReservations`
  - 학생 직접 예약 및 고정 배정 예약 기록
  - id 형식: `academyId__slotId__studentId`
- `studentPrivateBookingStats`
  - `studentCancelCount`
  - `studentCancelLimit`
- `lessons`
  - 고정 1:1 배정 수업도 저장됨
- `creditTransactions`
  - 발급/top-up/차감/복구/총횟수 조정 이력
- `notificationEvents`
  - private slot 예약/취소/닫기/열기 이벤트

## 11. Private 1:1 Functions 구조

주요 export:

- `listPrivateLessonSlotAvailability`
- `reservePrivateLessonSlot`
- `cancelPrivateLessonReservation`
- `cancelFixedPrivateLessonOccurrence`
- `adminClosePrivateLessonSlot`
- `adminReopenPrivateLessonSlot`
- `adminCancelPrivateLessonReservation`
- `updateStudentPrivateCancelAllowance`
- `autoDeductPendingLessons`
- `runAutoDeductPendingLessonsForTest`
- `markPrivateReservationOutcome`
- `updateTeacherStudentPackageCounts`
- `reversePrivateReservationOutcome`

## 12. Private 차감/복구/cancel allowance 정책

자동 차감:

- `autoDeductPendingLessons`
- `AUTO_DEDUCT_LESSONS_ENABLED`가 켜져야 실행.
- 매일 KST 00:30 스케줄.
- private reservation 종료 후 미차감 건을 찾아 `studentPackages` 차감 및 `creditTransactions` 생성.
- 이미 수동 차감된 예약은 skip.

수동 차감:

- `markPrivateReservationOutcome`
- 완료/노쇼 처리 시 `remainingCount - 1`, `usedCount + 1`.
- `deductionApplied`, `deductionPackageId`, `deductionCreditTransactionId` 저장.

복구:

- `reversePrivateReservationOutcome`
- 완료/노쇼 처리 취소 시 `usedCount - 1`, `remainingCount + 1`.
- reversal transaction 생성.

취소 한도:

- 기본 2회, 최대 24회.
- `studentPrivateBookingStats.studentCancelCount`, `studentCancelLimit`.
- 학생 취소만 count 증가.
- 관리자 취소는 학생 cancel count를 늘리지 않는다.
- 학생 직접 취소는 6시간 cutoff 적용.

확인 필요:

- production에서 `AUTO_DEDUCT_LESSONS_ENABLED`가 실제로 켜져 있는지.

## 13. Private 관련 보호 테스트

주요 테스트:

- `tests/private-package-top-up.spec.js`
  - 같은 선생님 package top-up
  - 강제 새 수강권
  - 다른 선생님 scope 분리
- `tests/private-lesson-slot-booking.spec.js`
  - 학생 직접 1:1 예약
  - tenant/scope/eligibility
  - revoked package 미노출
- `tests/private-fixed-slot-assignment.spec.js`
  - 주간 template 기반 고정 배정
  - 고정 취소 후 공개
  - 선생님 수업불가 닫기/열기
- `tests/fixed-private-lesson-release.spec.js`
  - 고정 수업 자리 공개
  - 다른 학생 예약
  - 캘린더/기록 표시
- `tests/student-private-cancel-allowance.spec.js`
  - 취소 한도 계산/문구/callable source assertion
- `tests/auto-lesson-deduction.spec.js`
  - private 예약 자동 차감
  - 수동 차감 skip
- `tests/private-reservation-outcome.spec.js`
- `tests/private-makeup-balance.spec.js`
- `tests/private-slot-teacher-identity.spec.js`
- `tests/student-private-lesson-history.spec.js`

주의:

- 일부 E2E는 `serviceAccountKey.json`이나 별도 환경 플래그가 있을 때만 실행된다.

## 14. Private 1:1 절대 보호 대상

건드리면 회귀 위험이 큰 로직:

- private 수강권 `teacherKey`/`teacherUid`/`teacherName` scope matching
- `studentPrivateAccessSummary`의 `teacherKeys`, `activePackageIds`, slot access sync
- 예약 시점에는 차감하지 않고 완료/노쇼/자동 차감 시 차감하는 정책
- `privateLessonReservations` id 형식: `academyId__slotId__studentId`
- fixed private lesson과 flexible/private slot 예약의 구분
- 학생 취소 6시간 cutoff와 cancel allowance count
- 관리자 취소와 학생 취소 count 분리
- 고정 수업 “자리 공개”와 “수업 자체 취소/선생님 수업불가”의 차이
- `creditTransactions` idempotency key와 reversal transaction
- `studentPackages.remainingCount`/`usedCount`/`status` 갱신 불변식
- `autoDeductPendingLessons`
- `functions/index.js` private callable 변경 시 관련 E2E 확인 필요

## 15. Group/OpenGroup 현재 설계 기준

`packageType: group`:

- 반 등록 단체반
- 특정 `groupClassId` 필요
- 수강권 발급 후 `groupStudents` active 연결
- 학생 화면 예약 버튼 없음
- “반 등록 수업” 중심으로 표시
- 필요 시 자유 예약 허용 옵션 가능

`packageType: openGroup`:

- 자유 예약 단체반
- `groupClassId` 없음
- `groupCourseType` 기준으로 수업과 매칭
- 남은 좌석에 선착순 예약
- 총 횟수 직접 입력
- 자유 예약 취소 가능 횟수 제한 옵션 가능

좌석 계산:

```text
remainingSeats = max(0, capacity - registeredAttendingCount - guestReservedCount)
```

코스 유형:

- 일반 영어회화
- 초급 영어회화
- 중급 영어회화
- 고급 영어회화
- 시험/특강

용어:

- “고정 학생” 대신 “반 등록 학생” 사용.

## 16. Group/OpenGroup 최근 완료 내용

- #112: group/openGroup 수강권 UI 라벨 polish
- #113: group ticket free booking permission
- #114: group ticket booking permission logic hardening
- #115: group booking availability UI polish
- #116: group admin package follow-up flows polish
- #117: group booking cancel limit policy
- #118: production hosting env guard

## 17. #117 배포 기록

- product-version HEAD: `2767da4 Add group booking cancel limit policy (#117)`
- GitHub Actions E2E success
- local validation success
- targeted functions deploy 성공:
  - `listGroupLessonAvailability`
  - `reserveGroupLessonSeat`
  - `cancelGroupLessonSeat`
  - `releaseGroupLessonFixedSeat`
  - `restoreGroupLessonFixedSeat`
- hosting deploy 성공
- `firestore.rules` deploy 생략
- 생략 이유: `firestore.rules` 변경 없음

## 18. #117 Hosting blank incident

증상:

- `daegumiami.com` blank 화면
- HTML은 200
- JS/CSS asset도 200
- MIME 문제 없음

원인:

- `.env.production` 없이 Vite production build 실행
- Firebase env가 bundle에 누락
- `Missing Firebase environment variables` 구조로 React 앱 부팅 실패

확인 증거:

- `daegumiami.com`과 `miamiacademyschedule.web.app` 동일 release
- deployed JS에 Firebase config 값 누락
- 새 bundle rebuild 후 marker 확인

복구:

- Firebase sdkconfig-derived temporary env 생성
- `.env.production` temporary symlink
- `npm run build`
- hosting-only redeploy
- functions/rules redeploy 없음

복구 확인:

- login screen 렌더링
- admin dashboard 진입
- 학생 관리/단체반 관리 진입
- private/group/openGroup 수강권 모달 렌더링
- functions logs obvious error 없음
- Missing Firebase env error 없음

## 19. #118 재발 방지 기준

- `package.json`에 guarded production hosting deploy scripts 추가
- `scripts/verify-production-dist-env.mjs` 추가
- `docs/production-deploy.md` 추가
- production hosting deploy는 `npm run deploy:hosting:production`만 사용
- `npm run build` 직접 사용 후 `firebase deploy --only hosting` 금지
- build 전 `.env.production` 검증
- build 후 `dist/assets/*.js`에 Firebase env embedded 여부 검증
- functions/rules와 hosting deploy 분리
- `.env.production`, `dist`, test artifacts, `serviceAccountKey.json` 커밋 금지

관련 문서:

- `docs/production-deploy.md`

## 20. 배포 기준 v1.1

Functions:

- `functions/index.js` 변경 시에만 targeted functions deploy 판단.
- private callable 변경 시 private 관련 E2E/static/source tests 확인.
- group callable 변경 시 group 관련 E2E/static/source tests 확인.

Hosting:

- frontend 변경 시 hosting deploy 판단.
- production hosting deploy는 반드시:

```sh
npm run deploy:hosting:production
```

- `.env.production` 없이 production build/deploy 금지.

Rules:

- `firestore.rules` 변경 없으면 rules deploy 금지.
- `firestore.rules` 변경 시 별도 QA/승인 필요.

배포 후 정리:

```sh
rm -rf dist test-results playwright-report .playwright-browsers
git status -sb
```

- secret symlink 제거
- product-version Actions success 확인

## 21. QA 상태 v1.1

완료:

- read-only production smoke QA
- login 화면 렌더링
- admin dashboard 진입
- 학생 관리 탭
- 단체반 관리 탭
- private/group/openGroup 수강권 모달 렌더링
- functions 5개 callable list 확인
- obvious production function error 없음

아직 선택 사항:

- 테스트 계정 기반 production write QA
- openGroup 수강권 저장
- group 수강권 저장/종료
- 실제 group 예약/취소
- private 1:1 직접 예약/취소
- private package top-up 저장
- cancel allowance 실제 저장/한도 도달
- `autoDeductPendingLessons` production env flag 확인

## 22. 금지 파일/주의

커밋 금지:

- `.env*`
- `serviceAccountKey.json`
- `dist/`
- `test-results/`
- `playwright-report/`
- `.playwright-browsers/`
- `node_modules/`
- `package-lock.json` 단독 변경

운영 주의:

- production write QA는 별도 승인 후 진행한다.
- secret 값, env 값, API key, service account 정보는 문서에 기록하지 않는다.
- 불확실한 항목은 “확인 필요”로 남긴다.

## 23. 남은 작업

- 테스트 계정 기반 write QA
- `www.daegumiami.com` DNS/custom domain 정리
- 기존 `groupClasses`의 `teacherName`/`displayName` 없는 데이터 정리
- 기존 private/group 데이터의 teacher display backfill 필요 여부 확인
- 학생 삭제 soft delete/archive 정책
- `AUTO_DEDUCT_LESSONS_ENABLED` production 상태 확인
- `firestore.rules` private collection 권한 세부 문서화
- 필요 시 마스터 문서 v1.1을 docx/pdf로 별도 생성
