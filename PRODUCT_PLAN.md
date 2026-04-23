# Miami Admin SaaS Product Plan

## 1. Product Goal

현재 Firebase 기반 단일 학원 운영 도구를 여러 학원이 동시에 사용할 수 있는 SaaS 제품으로 확장한다.

핵심 목표는 기존 React dashboard와 Firestore 데이터 구조를 최대한 재사용하면서, 모든 운영 데이터에 `academyId`를 부여해 학원 단위로 안전하게 분리하는 것이다. 1단계에서는 기능 확장보다 멀티테넌시, 권한, 데이터 격리, 운영 안정성을 우선한다.

제품 방향:

- 여러 학원이 같은 서비스에 가입해 독립적으로 학생, 수업, 반, 수강권, 출결을 관리한다.
- 학원별 관리자와 선생님 계정을 분리한다.
- 기존 단일 학원용 dashboard UX는 최대한 유지한다.
- `main`은 현재 학원 운영 안정판으로 유지하고, `product-version`에서 SaaS화를 진행한다.

## 2. Current Base

현재 프로젝트는 React + Firebase Auth + Firestore 기반 학원 관리 시스템이다.

주요 화면:

- `Dashboard.jsx`: 학생 관리, 반 관리, 캘린더, 수강권, 출결/차감 흐름의 중심 화면
- `AuthContext.jsx`: Firebase Auth 로그인 상태와 사용자 프로필 로딩
- `src/features/dashboard/**`: 학생, 그룹, 수업, 수강권, 출결 관련 feature hook/modal/section
- `firestore.rules`: 단일 학원 기준 admin/teacher 권한과 teacher 범위 제한

주요 Firestore 컬렉션:

- `users`
- `privateStudents`
- `lessons`
- `groupClasses`
- `groupStudents`
- `groupLessons`
- `studentPackages`
- `creditTransactions`

현재 구조의 장점:

- 단일 학원 운영에 필요한 core workflow가 이미 존재한다.
- 학생, 개인 수업, 그룹 수업, 수강권, 출결, 차감 이력이 연결되어 있다.
- admin/teacher role 및 일부 세부 권한(`canManageAttendance`, `canAddStudent` 등)이 이미 있다.
- Firestore rules에 teacher 접근 제한 개념이 이미 있다.

현재 SaaS 전환 시 한계:

- 대부분의 운영 컬렉션에 `academyId`가 없다.
- `users/{uid}`가 단일 프로필 역할을 하고 있어 여러 학원 소속을 표현하기 어렵다.
- Dashboard query가 전체 컬렉션 또는 teacher 기준으로만 동작한다.
- Firestore rules가 학원 단위 격리를 강제하지 않는다.
- 가입, 학원 생성, 구독, 초대, 온보딩 흐름이 없다.

## 3. Phase 1: MVP

Phase 1의 목표는 기존 기능을 거의 그대로 유지하면서 “한 Firebase project 안에서 여러 학원이 안전하게 공존”하도록 만드는 것이다.

### 3.1 academies

새 컬렉션:

```text
academies/{academyId}
```

필드 초안:

```js
{
  name: string,
  slug: string,
  ownerUid: string,
  status: 'active' | 'trial' | 'suspended',
  plan: 'free' | 'starter' | 'pro',
  timezone: 'Asia/Seoul',
  locale: 'ko-KR',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

역할:

- 학원 tenant의 root document
- dashboard 진입 시 현재 선택된 학원 정보 제공
- 추후 결제/구독 상태 연결

MVP에서는 `slug` 기반 공개 라우팅까지는 필수 아님. 먼저 로그인 후 사용자가 속한 학원 목록에서 하나를 선택하는 방식이 안전하다.

### 3.2 academyMemberships

새 컬렉션:

```text
academyMemberships/{membershipId}
```

권장 document id:

```text
{academyId}_{uid}
```

필드 초안:

```js
{
  academyId: string,
  uid: string,
  email: string,
  displayName: string,
  role: 'owner' | 'admin' | 'teacher' | 'staff',
  teacherName: string,
  status: 'active' | 'invited' | 'disabled',
  permissions: {
    canManageAttendance: boolean,
    canAddStudent: boolean,
    canEditStudent: boolean,
    canDeleteStudent: boolean,
    canEditLesson: boolean,
    canDeleteLesson: boolean,
    canCreateLessonDirectly: boolean,
    requiresLessonApproval: boolean
  },
  createdAt: timestamp,
  updatedAt: timestamp
}
```

역할:

- 사용자와 학원의 연결
- 기존 `users/{uid}`의 role/teacher 권한을 학원별 권한으로 이동
- 한 사용자가 여러 학원에 소속될 수 있게 함

`users/{uid}`는 전역 계정 프로필로 축소한다.

```js
{
  email: string,
  displayName: string,
  lastSelectedAcademyId: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 3.3 academyId 추가 대상 컬렉션

Phase 1에서 `academyId`를 반드시 추가할 컬렉션:

- `privateStudents`
- `lessons`
- `groupClasses`
- `groupStudents`
- `groupLessons`
- `studentPackages`
- `creditTransactions`

권장 필드:

```js
{
  academyId: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

기존 teacher 기반 제한은 유지하되, 항상 `academyId` 필터를 먼저 적용한다.

예시:

```js
query(
  collection(db, 'privateStudents'),
  where('academyId', '==', currentAcademyId)
)
```

teacher 계정은 추가로 teacher 필터를 적용한다.

```js
query(
  collection(db, 'privateStudents'),
  where('academyId', '==', currentAcademyId),
  where('teacher', '==', teacherName)
)
```

### 3.4 AuthContext 수정 포인트

현재 역할:

- Firebase Auth user 감지
- `users/{uid}`에서 role/profile 로딩

수정 방향:

1. 로그인 후 `users/{uid}` 전역 프로필을 읽는다.
2. `academyMemberships`에서 `uid == currentUid`, `status == active` memberships를 읽는다.
3. `currentAcademyId`를 결정한다.
4. 선택된 membership을 `userProfile` 또는 새 `currentMembership`으로 제공한다.
5. Dashboard는 `currentAcademyId`, `currentMembership.role`, `currentMembership.permissions`를 기준으로 query와 UI 권한을 계산한다.

권장 Context shape:

```js
{
  user,
  userAccount,
  memberships,
  currentAcademyId,
  currentAcademy,
  currentMembership,
  userProfile, // 기존 코드 호환용 adapter
  setCurrentAcademyId,
  loading
}
```

기존 코드 호환을 위해 Phase 1에서는 `userProfile` shape를 완전히 제거하지 말고 adapter로 유지한다.

```js
const userProfile = {
  role: currentMembership.role,
  teacherName: currentMembership.teacherName,
  ...currentMembership.permissions
}
```

### 3.5 Query 수정 포인트

`Dashboard.jsx`의 모든 운영 데이터 구독에 `academyId` 필터를 추가한다.

수정 대상 예시:

- `collection(db, 'lessons')`
- `collection(db, 'privateStudents')`
- `collection(db, 'groupClasses')`
- `collection(db, 'studentPackages')`
- `collection(db, 'groupStudents')`
- `collection(db, 'groupLessons')`
- `collection(db, 'creditTransactions')`

admin query 예시:

```js
query(collection(db, 'groupClasses'), where('academyId', '==', currentAcademyId))
```

teacher query 예시:

```js
query(
  collection(db, 'groupClasses'),
  where('academyId', '==', currentAcademyId),
  where('teacher', '==', teacherName)
)
```

write payload에도 `academyId`를 반드시 포함한다.

```js
await addDoc(collection(db, 'privateStudents'), {
  academyId: currentAcademyId,
  name,
  teacher,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
})
```

트랜잭션/배치에서도 관련 문서들의 `academyId`가 모두 같은지 확인한다.

### 3.6 firestore.rules 수정 포인트

rules 목표:

- 사용자는 본인이 active membership을 가진 academy 데이터만 읽고 쓸 수 있다.
- owner/admin은 해당 academy의 모든 운영 데이터에 접근 가능하다.
- teacher/staff는 해당 academy 안에서 권한과 teacherName 조건을 통과한 데이터만 접근 가능하다.

추가 rules helper 초안:

```js
function membershipPath(academyId) {
  return /databases/$(database)/documents/academyMemberships/$(academyId + '_' + request.auth.uid);
}

function myMembership(academyId) {
  return get(membershipPath(academyId)).data;
}

function isAcademyMember(academyId) {
  return signedIn() &&
    exists(membershipPath(academyId)) &&
    myMembership(academyId).status == 'active';
}

function isAcademyAdmin(academyId) {
  return isAcademyMember(academyId) &&
    (myMembership(academyId).role in ['owner', 'admin']);
}

function isAcademyTeacher(academyId) {
  return isAcademyMember(academyId) &&
    myMembership(academyId).role == 'teacher';
}

function myAcademyTeacherName(academyId) {
  return myMembership(academyId).teacherName;
}

function sameAcademyOnCreate() {
  return request.resource.data.academyId is string &&
    isAcademyMember(request.resource.data.academyId);
}

function sameAcademyOnRead() {
  return resource.data.academyId is string &&
    isAcademyMember(resource.data.academyId);
}

function academyIdUnchanged() {
  return request.resource.data.academyId == resource.data.academyId;
}
```

각 운영 컬렉션은 다음 패턴으로 전환한다.

```js
match /privateStudents/{studentId} {
  allow read: if sameAcademyOnRead() && (
    isAcademyAdmin(resource.data.academyId) ||
    privateStudentBelongsToTeacher(resource.data)
  );

  allow create: if sameAcademyOnCreate() && (
    isAcademyAdmin(request.resource.data.academyId) ||
    canAddStudentForAcademy(request.resource.data.academyId)
  );

  allow update: if sameAcademyOnRead() &&
    academyIdUnchanged() &&
    /* 기존 권한 조건 */;
}
```

MVP rules에서는 `academyId` 없는 legacy 문서 접근 정책을 명확히 정해야 한다.

권장:

- `main` 운영판은 legacy 유지
- `product-version`은 migration 완료 전까지 admin claim 사용자만 legacy 문서 접근 가능
- migration 완료 후 `academyId` 없는 운영 문서는 읽기/쓰기 금지

## 4. Phase 2: Sellable Product

Phase 2의 목표는 MVP 멀티테넌시 위에 실제 판매 가능한 가입, 온보딩, 권한, 결제 흐름을 붙이는 것이다.

### 4.1 가입/온보딩

필수 흐름:

1. 이메일/비밀번호 또는 Google 로그인
2. 학원 생성
3. 학원명, 시간대, 기본 수업 운영 방식 입력
4. 첫 관리자 membership 생성
5. 샘플 데이터 생성 여부 선택
6. Dashboard 진입

온보딩 데이터:

```js
academies/{academyId}
academyMemberships/{academyId}_{uid}
users/{uid}
```

초기 화면:

- `/signup`
- `/onboarding/create-academy`
- `/select-academy`
- `/dashboard`

초대 흐름:

```text
academyInvites/{inviteId}
```

필드 초안:

```js
{
  academyId: string,
  email: string,
  role: 'admin' | 'teacher' | 'staff',
  teacherName: string,
  permissions: object,
  status: 'pending' | 'accepted' | 'revoked' | 'expired',
  invitedByUid: string,
  expiresAt: timestamp,
  createdAt: timestamp
}
```

### 4.2 권한 구조

권장 role:

- `owner`: 결제, 학원 삭제, owner 이전, 모든 데이터 접근
- `admin`: 학원 운영 전체 관리, 결제 제외 가능
- `teacher`: 본인 학생/수업 중심 접근
- `staff`: 데스크/상담/수납 등 제한된 운영 접근

권한은 role + permissions 조합으로 설계한다.

권한 예시:

- `canManageAttendance`
- `canAddStudent`
- `canEditStudent`
- `canDeleteStudent`
- `canEditLesson`
- `canDeleteLesson`
- `canCreateLessonDirectly`
- `requiresLessonApproval`
- `canManagePackages`
- `canViewReports`
- `canManageMembers`
- `canManageBilling`

Phase 2에서는 권한 관리 UI가 필요하다.

- 구성원 목록
- 구성원 초대
- role 변경
- teacherName 매핑
- 세부 권한 toggle
- 비활성화

### 4.3 결제/구독

추천 결제 구조:

```text
academySubscriptions/{academyId}
billingEvents/{eventId}
```

`academySubscriptions/{academyId}` 필드 초안:

```js
{
  academyId: string,
  provider: 'stripe' | 'tosspayments',
  providerCustomerId: string,
  providerSubscriptionId: string,
  status: 'trialing' | 'active' | 'past_due' | 'canceled',
  plan: 'starter' | 'pro',
  currentPeriodStart: timestamp,
  currentPeriodEnd: timestamp,
  trialEndsAt: timestamp,
  seatLimit: number,
  activeMemberCount: number,
  updatedAt: timestamp
}
```

구독 gating:

- `academies.status == active/trial`일 때만 dashboard write 허용
- `past_due`는 read 허용, write 제한 또는 grace period 적용
- `canceled/suspended`는 read-only 모드

초기 과금 기준 추천:

- Starter: 월 정액, 선생님/직원 수 제한
- Pro: 더 많은 구성원, 리포트, 알림, 자동화 포함
- 초기에는 학생 수 과금보다 seat 기반이 운영과 설명이 쉽다.

## 5. Phase 3: Expansion

### 5.1 모바일

모바일 방향:

- 원장/관리자용 mobile web dashboard
- 선생님용 출결/오늘 수업 중심 mobile web
- 학부모/학생 앱은 별도 phase로 분리

우선순위:

1. 선생님 오늘 수업 목록
2. 출결/차감 빠른 처리
3. 학생 연락처/메모 확인
4. 수업 변경 요청

### 5.2 알림

알림 채널:

- 이메일
- SMS 또는 알림톡
- 앱 push 또는 web push

알림 대상:

- 수업 전 알림
- 결석/차감 알림
- 수강권 잔여 횟수 부족
- 수강권 만료 예정
- 결제 실패/구독 만료
- 선생님 초대

추천 컬렉션:

```text
notificationTemplates/{templateId}
notificationJobs/{jobId}
notificationLogs/{logId}
```

모든 알림에도 `academyId`를 포함한다.

### 5.3 리포트

초기 리포트:

- 월별 매출
- 학생 증가/이탈
- 선생님별 수업 수
- 반별 출석률
- 수강권 잔여/만료 예정
- 차감/복구 이력

기술 방향:

- MVP는 Firestore aggregation + client 계산으로 시작
- 데이터가 커지면 Cloud Functions scheduled summary 생성
- 장기적으로 BigQuery export 고려

추천 summary 컬렉션:

```text
academyMonthlyReports/{academyId_yyyyMM}
teacherMonthlyReports/{academyId_teacherName_yyyyMM}
```

## 6. Revenue Model

초기 권장 모델:

- Free Trial: 14일 또는 30일
- Starter: 소규모 학원용, 기본 학생/수업/수강권/출결
- Pro: 권한 관리, 리포트, 알림, 고급 자동화

과금 기준:

- 기본은 학원 단위 월 구독
- plan별 active member seat 제한
- Pro부터 알림 사용량 기반 추가 과금 가능

예시:

- Starter: 월 정액, 최대 3 seats
- Pro: 월 정액, 최대 10 seats, 리포트/알림 포함
- Additional Seat: seat당 추가 과금
- Notification Usage: SMS/알림톡 실비 + 마진

초기에는 복잡한 학생 수 기반 과금을 피한다. 학원 입장에서는 학생 수 변동보다 “관리자/선생님 계정 수”가 예측 가능하고 설명하기 쉽다.

## 7. Technical Direction

### 7.1 데이터 모델 원칙

- 모든 tenant 운영 데이터는 root collection 유지 + `academyId` 필드 추가
- subcollection으로 대규모 구조 변경하지 않는다
- 기존 Dashboard query를 `where('academyId', '==', currentAcademyId)` 중심으로 점진 수정한다
- document id는 기존 랜덤 id 유지
- cross-academy 참조 금지

root collection 유지 이유:

- 현재 코드 재사용성이 높다.
- collection group 불필요.
- 기존 indexes와 query 패턴을 크게 바꾸지 않아도 된다.
- migration이 단순하다.

### 7.2 Index 전략

`academyId` 추가 후 필요한 composite index 예시:

- `privateStudents`: `academyId + teacher`
- `lessons`: `academyId + teacherName`
- `lessons`: `academyId + teacher`
- `groupClasses`: `academyId + teacher`
- `groupStudents`: `academyId + groupClassId`
- `groupStudents`: `academyId + studentId`
- `groupLessons`: `academyId + groupClassId`
- `groupLessons`: `academyId + groupClassID`
- `studentPackages`: `academyId + teacher`
- `studentPackages`: `academyId + studentId`
- `creditTransactions`: `academyId + packageId`

### 7.3 Migration 전략

Phase 1 migration 순서:

1. 기본 academy 하나 생성
2. 기존 운영 데이터를 해당 `academyId`로 backfill
3. 기존 `users/{uid}`에서 role/teacherName/permissions를 읽어 `academyMemberships` 생성
4. query에 academyId 필터 추가
5. write payload에 academyId 추가
6. firestore.rules를 academyId 기반으로 전환
7. legacy fallback 제거

backfill script는 dry-run을 지원해야 한다.

```text
scripts/backfill-academy-id.mjs
scripts/create-initial-academy-memberships.mjs
```

### 7.4 UI 방향

MVP에서는 대규모 디자인 변경을 하지 않는다.

필수 UI만 추가:

- 현재 학원 표시
- 여러 학원 소속이면 academy switcher
- 구성원 관리 최소 화면
- owner/admin용 학원 설정 화면

Dashboard 내부 학생/반/캘린더 UX는 기존 구조 유지.

## 8. Recommended Implementation Order

1. `academies`, `academyMemberships` schema 정의
2. local/e2e Firebase에 기본 academy seed 생성
3. `AuthContext`를 membership 기반으로 확장
4. `currentAcademyId`를 Dashboard에 주입
5. read query에 `academyId` 필터 추가
6. create/update payload에 `academyId` 추가
7. group/private attendance transaction에서 academyId 검증 추가
8. Firestore rules에 academy membership helper 추가
9. 기존 데이터 backfill script 작성
10. e2e fixture/helper에 `academyId` 기본값 추가
11. academy switcher 최소 UI 추가
12. 구성원 관리 MVP 추가
13. 가입/온보딩 추가
14. 결제/구독 read-only gating 추가
15. Phase 2 결제 provider 연동

가장 먼저 해야 할 개발 단위:

- `AuthContext`에서 `currentAcademyId`와 `currentMembership`을 제공
- `Dashboard.jsx`의 read query를 academy-scoped로 전환
- Firestore rules를 academy-scoped로 전환

이 세 가지가 끝나야 SaaS 전환의 핵심 리스크가 줄어든다.

### Sprint 1 Execution Order

Sprint 1은 UI와 rules 전환 전에 데이터 모델과 마이그레이션 안전장치를 먼저 준비한다.

1. E2E seed에 기본 `academies/{academyId}`와 `academyMemberships/{academyId_uid}`를 생성한다.
2. E2E fixture/helper가 새 운영 문서에 `academyId`를 포함하도록 만든다.
3. `scripts/backfill-academy-id.mjs --dry-run`으로 기존 운영 문서에 들어갈 변경 내역을 먼저 확인한다.
4. dry-run 결과의 project, academyId, 변경 문서 수를 확인한 뒤에만 `--write`로 실제 backfill을 실행한다.
5. 다음 Sprint에서 `AuthContext`, dashboard query, write payload, `firestore.rules`를 academy-scoped로 전환한다.

기본 실행 예시:

```bash
npm run backfill:academy-id -- --dry-run --academy-id=academy_default --academy-name="Default Academy"
npm run backfill:academy-id -- --write --academy-id=academy_default --academy-name="Default Academy"
```

### Student Booking System Design

학생용 예약 시스템은 현재 관리자 dashboard의 운영 컬렉션을 유지하면서 학생 portal에서 필요한 최소 문서만 추가한다. 핵심 원칙은 `privateStudents`, `lessons`, `groupLessons`, `studentPackages`, `creditTransactions`를 계속 canonical 운영 데이터로 쓰고, 학생 로그인/예약 요청/좌석 점유 상태만 얇게 보강하는 것이다.

#### 1. 설계 개요

목표:

- 학생이 로그인해서 본인 프로필, 수강권 잔여 횟수, 예약 가능한 개인/오픈 그룹수업을 볼 수 있다.
- 개인수업은 담당 선생님, 수강권, 시간 충돌을 검증한 뒤 `lessons` 문서로 예약된다.
- 오픈 그룹수업은 `groupLessons.capacity/bookedCount`를 기준으로 실시간 좌석을 보여주고, transaction으로 선착순 마감한다.
- 모든 수강권 변경은 `studentPackages`의 현재 상태와 `creditTransactions` ledger를 함께 남긴다.
- 모든 문서에는 `academyId`를 포함하고, 다음 Sprint의 rules/query 전환 후 학원 간 접근을 차단한다.

#### 2. 학생 계정 구조

기존 `privateStudents/{studentId}`는 학원 내부 학생 원장으로 유지한다. 학생 로그인은 Firebase Auth uid를 전역 `users/{uid}`에 만들고, 학원 내 학생 원장과 연결한다.

```js
users/{uid} = {
  uid: string,
  email: string,
  displayName: string,
  phone: string,
  accountTypes: ['student'],
  lastSelectedAcademyId: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

```js
privateStudents/{studentId} = {
  academyId: string,
  name: string,
  phone: string,
  teacher: string,
  studentAuthUid: string,
  portalEmail: string,
  portalStatus: 'invited' | 'active' | 'disabled',
  portalLinkedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

여러 학원 또는 보호자 계정까지 확장하려면 별도 연결 컬렉션을 둔다.

```js
studentAcademyLinks/{academyId_uid_studentId} = {
  academyId: string,
  uid: string,
  studentId: string,
  relationship: 'self' | 'guardian',
  status: 'active' | 'invited' | 'disabled',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

MVP에서는 `privateStudents.studentAuthUid`만으로 시작할 수 있고, 다중 학원/보호자 지원 시 `studentAcademyLinks`를 활성화한다.

#### 3. 개인수업 예약 구조

개인수업 예약은 기존 `lessons` 컬렉션을 재사용한다. 학생이 예약해도 최종 운영 일정은 `lessons/{lessonId}`가 된다.

추가/확장 필드:

```js
lessons/{lessonId} = {
  academyId: string,
  studentId: string,
  studentName: string,
  studentAuthUid: string,
  teacher: string,
  teacherName: string,
  date: 'YYYY-MM-DD',
  time: 'HH:mm',
  startAt: timestamp,
  endAt: timestamp,
  durationMinutes: number,
  subject: string,
  packageId: string,
  packageType: 'private',
  reservationSource: 'admin' | 'student',
  reservationStatus: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show',
  approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected',
  cancellationReason: string,
  completed: boolean,
  isDeductCancelled: boolean,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

시간 충돌 방지:

- 같은 `academyId + teacher + date + time` 조합의 active lesson을 확인한다.
- 더 정확한 충돌 검사는 `startAt < requestedEndAt && endAt > requestedStartAt` 조건이 필요하므로 Cloud Function 또는 transaction 내부에서 선생님 일별 slot 문서를 함께 사용한다.
- MVP에서는 30/60분 고정 slot이면 `teacherAvailabilitySlots/{academyId_teacher_yyyyMMdd_HHmm}`를 만들고 transaction에서 `status`를 `available -> booked`로 바꾼다.

권장 slot 문서:

```js
teacherAvailabilitySlots/{slotId} = {
  academyId: string,
  teacher: string,
  date: 'YYYY-MM-DD',
  time: 'HH:mm',
  startAt: timestamp,
  endAt: timestamp,
  status: 'available' | 'booked' | 'blocked',
  lessonId: string,
  bookedByUid: string,
  updatedAt: timestamp
}
```

#### 4. 오픈 그룹수업 예약 구조

오픈 그룹수업은 기존 `groupLessons`에 이미 있는 `bookingMode`, `capacity`, `bookedCount`, `isBookable`를 확장한다.

```js
groupLessons/{groupLessonId} = {
  academyId: string,
  groupClassId: string,
  groupClassName: string,
  teacher: string,
  date: 'YYYY-MM-DD',
  time: 'HH:mm',
  startAt: timestamp,
  subject: string,
  bookingMode: 'fixed' | 'open',
  isBookable: boolean,
  bookingOpenAt: timestamp,
  bookingCloseAt: timestamp,
  capacity: number,
  bookedCount: number,
  waitlistCount: number,
  reservationStatus: 'open' | 'full' | 'closed' | 'cancelled',
  countedStudentIDs: string[],
  createdAt: timestamp,
  updatedAt: timestamp
}
```

학생별 예약은 별도 컬렉션으로 둔다. 배열만으로 예약자를 관리하면 rules, 취소, 중복 예약, 감사 로그가 약해진다.

```js
lessonBookings/{bookingId} = {
  academyId: string,
  bookingType: 'openGroup' | 'private',
  lessonCollection: 'groupLessons' | 'lessons',
  lessonId: string,
  groupClassId: string,
  studentId: string,
  studentAuthUid: string,
  packageId: string,
  status: 'booked' | 'cancelled' | 'waitlisted' | 'attended' | 'no_show',
  seatNumber: number,
  bookedAt: timestamp,
  cancelledAt: timestamp,
  cancellationReason: string,
  source: 'student' | 'admin',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

좌석 표시:

- list 화면은 `groupLessons.capacity`와 `groupLessons.bookedCount`만 구독해 빠르게 `remainingSeats = capacity - bookedCount`를 표시한다.
- 상세 화면은 `lessonBookings`에서 `academyId + lessonId + status == booked`를 조회해 내 예약 여부와 예약자 수를 확인한다.
- 선착순 예약은 Firestore transaction으로 `groupLessons`와 `lessonBookings`를 함께 읽고 쓴다.

선착순 transaction 조건:

- `academyId`가 모두 일치해야 한다.
- `bookingMode === 'open'`
- `isBookable === true`
- 현재 시간이 `bookingOpenAt <= now < bookingCloseAt`
- `bookedCount < capacity`
- 같은 `studentId + lessonId`의 active booking이 없어야 한다.
- 연결 수강권의 `remainingCount > 0`

#### 5. 수강권/크레딧 차감 구조

현재 `studentPackages`는 현재 상태, `creditTransactions`는 이력으로 유지한다. 앞으로는 모든 생성/차감/복구/관리자 조정을 ledger 중심으로 남기고, `studentPackages.usedCount/remainingCount/status`는 transaction 결과 스냅샷으로 취급한다.

```js
studentPackages/{packageId} = {
  academyId: string,
  studentId: string,
  studentAuthUid: string,
  packageType: 'private' | 'group' | 'openGroup',
  teacher: string,
  groupClassId: string,
  title: string,
  totalCount: number,
  usedCount: number,
  remainingCount: number,
  status: 'active' | 'usedUp' | 'ended' | 'expired' | 'cancelled',
  validFrom: 'YYYY-MM-DD',
  expiresAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

```js
creditTransactions/{txId} = {
  academyId: string,
  studentId: string,
  studentAuthUid: string,
  packageId: string,
  packageType: 'private' | 'group' | 'openGroup',
  sourceType: 'studentPackage' | 'privateLesson' | 'groupLesson' | 'booking' | 'adminAdjustment',
  sourceId: string,
  actionType:
    'package_created' |
    'private_deduct' |
    'group_deduct' |
    'open_group_booking_hold' |
    'booking_cancel_restore' |
    'deduct_restore' |
    'admin_adjustment',
  deltaCount: number,
  balanceBefore: number,
  balanceAfter: number,
  actorUid: string,
  actorRole: 'student' | 'admin' | 'teacher' | 'system',
  memo: string,
  createdAt: timestamp
}
```

차감 정책:

- 수강권 생성: `studentPackages` 생성 + `creditTransactions(package_created, +totalCount)` 기록.
- 개인수업 예약: MVP는 예약 시 차감하지 않고 수업 완료/출석 처리 시 차감한다. 노쇼/선결제 정책이 필요해지면 `hold` 상태를 추가한다.
- 오픈 그룹 예약: 좌석 남용 방지를 위해 예약 시 `open_group_booking_hold(-1)`로 먼저 차감하는 방식을 권장한다.
- 오픈 그룹 취소: 마감 전 취소면 `booking_cancel_restore(+1)`로 복구하고 `bookedCount`를 감소한다.
- 출석 확정: 이미 예약 hold가 있으면 booking status만 `attended`로 바꾸고 추가 차감하지 않는다.
- 관리자 복구: 기존 `group_deduct_restore`를 `deduct_restore(+1)`로 일반화하고 원본 tx id를 `reversalOfTxId`로 남긴다.
- 관리자 조정: `admin_adjustment(+/-n)`을 별도 action으로 남기고 직접 `remainingCount`만 바꾸지 않는다.

#### 6. 최소 Firestore 컬렉션

재사용:

- `privateStudents`: 학생 원장, portal 연결 필드 추가
- `lessons`: 개인수업 예약/확정 일정
- `groupClasses`: 그룹수업 기본 정보
- `groupLessons`: 오픈 그룹수업 slot과 좌석 카운터
- `studentPackages`: 수강권 현재 상태
- `creditTransactions`: 수강권 ledger
- `users`: 학생/관리자/선생님 전역 로그인 프로필

신규 권장:

- `lessonBookings`: 학생별 예약 상태
- `teacherAvailabilitySlots`: 개인수업 시간 충돌 방지용 slot
- `studentAcademyLinks`: 다중 학원/보호자 계정 확장 시 사용

#### 7. 새 필드와 기존 확장 구분

바로 추가할 필드:

- `privateStudents`: `academyId`, `studentAuthUid`, `portalEmail`, `portalStatus`, `portalLinkedAt`
- `lessons`: `academyId`, `studentAuthUid`, `endAt`, `durationMinutes`, `reservationSource`, `reservationStatus`, `approvalStatus`
- `groupLessons`: `academyId`, `bookingOpenAt`, `bookingCloseAt`, `waitlistCount`, `reservationStatus`
- `studentPackages`: `academyId`, `studentAuthUid`, `validFrom`
- `creditTransactions`: `academyId`, `studentAuthUid`, `balanceBefore`, `balanceAfter`, `reversalOfTxId`

나중에 추가할 필드:

- `lessons`: `paymentHoldId`, `rescheduleOfLessonId`
- `groupLessons`: `waitlistEnabled`, `minStudents`, `autoCloseReason`
- `lessonBookings`: `checkedInAt`, `noShowMarkedAt`, `refundPolicySnapshot`
- `studentPackages`: `purchaseChannel`, `subscriptionId`, `refundStatus`

#### 8. 예약/차감 흐름

개인수업 예약:

1. 학생이 로그인하고 `studentAuthUid + academyId`로 본인 `privateStudents`를 찾는다.
2. active private `studentPackages` 중 `remainingCount > 0`인 수강권을 선택한다.
3. 선생님/날짜/시간 slot을 선택한다.
4. transaction에서 `teacherAvailabilitySlots`가 available인지 확인한다.
5. `lessons`를 `reservationStatus: confirmed` 또는 `pending`으로 생성한다.
6. slot을 booked로 변경한다.
7. 수업 완료 또는 출석 처리 시 `studentPackages`와 `creditTransactions`를 transaction으로 차감한다.

오픈 그룹수업 예약:

1. 학생이 `groupLessons`에서 `bookingMode == open`, `isBookable == true`, `academyId == currentAcademyId`인 수업을 본다.
2. UI는 `capacity - bookedCount`로 잔여 좌석을 표시한다.
3. 예약 버튼 클릭 시 transaction에서 `bookedCount < capacity`, 중복 booking 없음, 수강권 잔여 횟수를 확인한다.
4. `lessonBookings`를 `booked`로 생성한다.
5. `groupLessons.bookedCount`를 1 증가한다.
6. 정책상 예약 시 차감이면 `studentPackages.remainingCount`를 1 감소하고 `creditTransactions(open_group_booking_hold, -1)`를 만든다.
7. 취소 시 booking을 `cancelled`로 변경하고 `bookedCount`와 수강권을 복구한다.

관리자 차감/복구:

1. 모든 차감/복구는 `studentPackages` 현재값 변경과 `creditTransactions` 생성을 같은 transaction 또는 callable function에서 처리한다.
2. 복구는 원본 tx를 찾아 `reversalOfTxId`를 남긴다.
3. 직접 수정은 `admin_adjustment`로만 허용한다.

#### 9. 구현 우선순위

가장 먼저 만들 것:

1. `academyId` query/rules 전환 완료
2. `studentPackages`와 `creditTransactions` ledger 필드 확장
3. `lessonBookings` 컬렉션과 오픈 그룹 예약 transaction
4. `groupLessons` 오픈 예약 필드 UI 표시
5. 학생 로그인 계정과 `privateStudents.studentAuthUid` 연결

그 다음 붙일 것:

1. 개인수업 `teacherAvailabilitySlots`
2. 학생용 예약 화면
3. 예약 취소/복구 정책
4. waitlist
5. 알림
6. 결제/환불 연동

나중으로 미룰 것:

- 보호자 다중 학생 계정
- 복잡한 reschedule 정책
- subscription billing 자동 차감
- teacher별 커스텀 예약 가능 시간 UI
- Cloud Functions 기반 대규모 정산 리포트

#### 10. 다음 실제 코딩 단계

Firebase quota가 회복되기 전에는 로컬 코드/테스트 중심으로 다음 순서를 권장한다.

1. `src/**` 변경 없이 `tests/fixtures`와 seed 문서에 `lessonBookings` 예시 fixture를 추가한다.
2. `creditTransactions` 생성 helper의 payload에 `balanceBefore/balanceAfter/academyId`를 받을 수 있게 준비한다.
3. `groupLessons` open booking fixture를 추가하고 좌석 표시용 selector/e2e 초안을 작성한다.
4. quota 회복 후 E2E Firebase에서 `academyId` backfill dry-run을 먼저 검증한다.
5. 그 다음 `AuthContext/query/rules`를 academy-scoped로 전환한다.

## 9. Branch Strategy

### main

`main`은 현재 학원 운영 안정판이다.

원칙:

- 실제 학원 운영을 깨지 않는 변경만 반영
- 버그 수정, 테스트 안정화, 작은 UX 개선 중심
- SaaS 구조 변경은 충분히 검증된 뒤에만 병합
- academyId migration 전까지는 단일 학원 운영 기준 유지

### product-version

`product-version`은 제품화 개발판이다.

원칙:

- academyId 기반 멀티테넌시 작업은 여기서 진행
- schema, AuthContext, query, rules, onboarding 변경을 실험
- e2e는 product-version 기준으로 별도 안정화
- main과 장기간 diverge하지 않도록 bugfix는 주기적으로 merge/rebase

권장 workflow:

```text
main
  안정 운영 / 긴급 수정

product-version
  SaaS 제품화 개발

feature/product-academy-schema
feature/product-auth-memberships
feature/product-academy-scoped-queries
feature/product-firestore-rules
feature/product-onboarding
feature/product-billing
```

병합 기준:

- `product-version` 내부 feature branch는 PR 단위로 병합
- Phase 1 MVP가 e2e와 rules test를 통과하면 product beta deploy
- main 병합은 실제 운영 환경 migration plan이 준비된 뒤 진행
