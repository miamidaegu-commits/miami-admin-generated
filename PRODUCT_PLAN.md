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
