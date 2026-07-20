# Academy reset write-freeze runbook

이 문서는 `daegu-miami-production`의 `academy_daegumiami` reset 전에 필요한
write-freeze 증거 계약만 정의한다. 이 변경은 배포, IAM/scheduler 변경,
sentinel 활성화, probe, planner, reset, unfreeze를 실행하거나 구현하지 않는다.
기존 advisory planner의 `writeFreezeVerified: false`와 comparison-only baseline은
승인 또는 실행 권한이 아니다.

## Fail-closed 고정값

- contract/proof: `academy_reset_write_freeze.v8` /
  `academy_reset_write_freeze_proof.v8`
- Observation Contract: `academy_reset_provider_observation.v8`
- deployment approval/provider dependency:
  `academy_reset_deployment_approval.v9` /
  `academy_reset_provider_dependency.v8`
- project/academy: `daegu-miami-production` / `academy_daegumiami`
- Functions: `us-central1`, `GEN_2`, 35개 exact deployed function set과 별도의
  26개 exact guarded export set
- provider adapter ID/contract:
  `gcp_immutable_resource_observer.v1` /
  `academy_reset_freeze_provider_adapter.v8`
- Stage A provider operation registry:
  `academy_reset_freeze_provider_operations.v6`, exact 30 operations,
  descriptor-set SHA-256
  `7807e7c68a5995cae008587d0e93748f34c00ec575cbc189f8d6a64c6230a52d`
- operation classification:
  `academy_reset_freeze_operation_classification.v2`; 필수 29개와 선택 진단 1개,
  mandatory-set SHA-256
  `acee45a37aea22392a016913a0cd6e8392a017fafdfe04c2c1550c113acd9327`,
  optional-set SHA-256
  `4b152b183bd0cde66744b0d58dda6af4672d3eeb8208fe0346ffb90f9ccdbad3`,
  classification SHA-256
  `45d609e3d0b4f0a2c413b8e8437a6d4c8187c8463415008e478ffc28f7f510d5`
- read-only permission manifest:
  `academy_reset_freeze_readonly_permissions.v2`, SHA-256
  `73cb701e479a2dc63996ad71c278ddc2b68df3cebcb04ba77cbc609e3de8679a`;
  reviewed-evidence SHA-256
  `9b72f1f8be2800b93174d500a1b5e60d950e7748168c38ce2ca02ca666aeb301`,
  official-evidence SHA-256
  `8f3b4b2797483f4581a3cd0e58c66efa54b4726470bfcc2bfa5c2989085d3e80`,
  research-artifact SHA-256
  `92c38c6007050d5427fafb8a4d09c8963592f492e7bc29345281055ed64be704`,
  effective mandatory permission contract SHA-256
  `957f28b97f279a58f43ad7e4b4b4e74d90610a4329753f92159aff6e6e4b57c2`
- freeze window: 최대 3600초
- writer source: registry의 literal SHA-256 pin 21개
- reset collection: 29개
- 누락, extra, duplicate, stale, unknown, target mismatch는 상태가 disabled 또는
  read-only처럼 보여도 거부한다.

30개 registry operation은 실행 완전성에서 동일한 지위를 갖지 않는다.
필수 29개만 provider observation과 IAM raw analysis의 근거다. Policy
Troubleshooter `iam:troubleshoot`는 선택 진단 1개이며 누락돼도
`providerObservationComplete`에 실패하지 않는다. 실행되더라도 mandatory operation을
대체할 수 없고 policy analysis 또는 write-freeze proof 입력이 아니다.
따라서 선택 진단만 성공해도 `policyAnalysisComplete`,
`writeFreezeVerified`, `executionEligible`은 모두 false다.

## 1. Release와 local Git 고정

검토한 단일 release SHA를 고정한다. verifier는 network Git을 사용하지 않고
local Git에서 다음을 모두 확인한다.

- HEAD가 release SHA와 같고 worktree가 clean
- contract의 critical source exact set
- 각 source가 tracked regular HEAD blob(`100644` 또는 `100755`)
- runtime bytes와 HEAD blob bytes 및 SHA-256가 같음
- index flag가 정확히 `H`; skip-worktree/assume-unchanged 불허
- registry에 고정된 writer source 21개 모두 runtime SHA-256가 literal pin과 같음

`functions/index.js` pin은 통합된 최종 source로 반드시 다시 계산하고
`EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST`도 함께 갱신한다. 중간 branch 계산값을
최종 release 진실로 재사용하지 않는다.

## 2. Provider observation과 approval lineage 분리

provider-observable, approval lineage, operational telemetry는 서로 다른
증거이며 한 필드로 합치지 않는다.

### Provider-observable

승인된 adapter는 API에서 직접 읽은 다음 상태만 보고한다.

- Rules: exact project ID/number, full release/ruleset resource name,
  release/ruleset 각각의 provider create/update time, completeness
- Functions: 35개 function exact set과 별도의 26개 guarded export exact set
- 각 Function: name/project/region/runtime/`GEN_2`/revision/build/update time,
  provider source identity, runtime service account
- 각 runtime service account는 canonical 35-Function mapping과 일치해야 한다.
  32개 baseline Function은 compute default, 두 Writer Function은
  `academy-private-writer-runtime`, Preview Function은
  `academy-private-preview-rt`를 사용한다.
- freeze-active evidence에서 세 runtime identity는 모두 exact read-only 3-permission
  profile이어야 한다. Writer steady 5-permission role은 freeze evidence가 아니다.
- IAM raw evidence와 Scheduler provider inventory

Rules API가 local source tree, bundle SHA-256 또는 승인 artifact lineage를
제공한다고 주장하지 않는다. Rules provider observation에는 source bundle
필드가 없다. `providerRulesetPayloadDigest`는 두 provider 응답의 안정성 비교용
payload fingerprint일 뿐 local `firestore.rules` 또는 배포 bundle digest가 아니다.

### Approval lineage

독립 승인 시스템의 exact receipt가 다음을 별도로 결합한다.

- project ID/number와 release SHA
- local `firestore.rules` 및 `functions/index.js` HEAD SHA-256
- writer source identity digest
- approved Rules artifact digest와 approved source digest
- 승인한 full Rules release/ruleset resource name
- 승인한 35개 Function provider identity
- production full IAM principal allowlist
- versioned approved IAM expected state: raw policy digest와 9개 family별 exact
  expected count/canonical digest 및 expected-state digest

verifier는 adapter가 반환한 receipt와 operator evidence receipt를 canonical exact
비교한다. Rules에서는 provider가 관측한 release/ruleset 이름만 승인 lineage와
결합하며, provider API에 존재하지 않는 source lineage를 추론하지 않는다.
Functions provider record는 승인된 record와 exact 비교한다.

adapter의 `observeDeployment()`가 async이면 verifier는 반드시 `await`하며,
resolve 전에 proof를 만들지 않는다. provider adapter가 없는 standalone CLI,
단순 self-report, 같은 모양의 임의 digest, 콘솔의 “최근 배포” 표시는 모두
통과 근거가 아니다.

### 공통 completeness

Rules, Functions, IAM, Scheduler 각각은 동일한 completeness schema를 사용한다.

- `scanStartedAt`, `scanCompletedAt`, `pageCount`
- `nextPageTokenExhausted: true`
- 빈 `unreachableResources`
- `observedCount === expectedCount`
- canonical observed-set digest를 재계산한 `observedSetDigest`
- 같은 digest의 `startSetDigest`/`endSetDigest`, `stable: true`

누락된 필드, 미소진 pagination, unreachable resource, count 불일치, partial 또는
start/end set 변동은 fail closed다.

각 family의 `scanCompletedAt`은 전체 provider `observedAt`보다 늦을 수 없다.
전체 `observedAt`은 모든 Rules/Functions/IAM/Scheduler scan 완료 이후의 envelope
시각이다. 반면 deployment chronology의 `latestDeploymentObservedAt`은 Rules와
Functions의 provider resource update time만 사용한다. IAM/Scheduler policy scan이
freeze activation 뒤에 완료되는 정상 흐름을 deployment 시각으로 오인하지 않는다.
단, Rules와 Functions deployment scan은 둘 다 `freezeWindow.activatedAt` 전에
완료되어야 한다. 둘 중 늦은 완료 시각은
`latestDeploymentScanCompletedAt`으로 activation chronology와 proof에 결합한다.

이 metadata는 adapter가 제출한 scan 결과의 내부 완전성·안정성을 검증한다.
adapter가 실제 provider API를 exhaustive pagination 했는지를 이 local contract가
스스로 발견하거나 증명할 수는 없다. Production proof는 별도 검토된 adapter가
구현되기 전에는 생성할 수 없다.
approved IAM expected state도 서명이나 provider acquisition을 대신하지 않는 승인
lineage root-of-trust다. future adapter가 exhaustive provider acquisition을 수행한
뒤 그 결과를 독립 승인 snapshot과 비교해야 한다.

## 3. Sentinel 활성화

별도 승인 절차로 `academies/academy_daegumiami.resetWriteFreeze`를 활성화한다.
증거에는 exact provider/project/academy/document/field/mode/schema,
`writeFreezeActive: true`, 양의 integer generation, immutable version timestamp,
snapshot digest, writer registry digest가 필요하다.
`snapshotDigest`는 그 필드 자체를 제외한 sentinel 전체 canonical fields에서
verifier가 재계산한다.
현재 계약은 writer-backed consistency를 보수적으로
`version === capturedAt <= verifiedAt` exact equality/order로 제한한다.

`freezeWindow.activatedAt`은 sentinel 활성화 시작이고 `sentinel.capturedAt`은
그 generation/version이 active임을 관측한 시각이다.

## 4. Scheduler provider observation

중앙 `SCHEDULER_JOB_ALLOWLIST`와 provider inventory가 exact 일치해야 한다.
현재 job은 `autoDeductPendingLessons` 하나이며 name/project/region/target/state/
provider update time과 completeness가 필요하다. unknown disabled job도 거부한다.

Scheduler API의 `DISABLED` 관측은 새 schedule ingress가 중지됐다는 증거일 뿐,
이미 시작된 active invocation 수가 0임을 증명하지 않는다.

## 5. 별도 drain operational telemetry

active invocation과 writer quiet 상태는 Scheduler provider observation이 아니라
별도 telemetry로 증명한다.

- sentinel generation과 `schedulerStoppedAt`
- 마지막 writer ingress/completion 시각
- 120~900초의 bounded quiet window 시작/종료
- callable/scheduled/Auth/backend writer class exact 4종 checkpoint
- 각 class의 ingress 차단, in-flight 0, quiet-window ingress/completion counter 0
- checkpoint의 sentinel generation과 canonical telemetry digest
- 모든 checkpoint는 quiet-window 종료 이후이면서 `verifiedAt`, verifier 현재 시각,
  freeze expiry 이전이어야 함

quiet window가 짧거나 너무 길고, window 중 ingress/completion이 발생하고,
counter가 0이 아니고, generation이 stale하거나 class가 하나라도 누락되면
거부한다.
Scheduler job update time과 scheduler scan completion은 `schedulerStoppedAt`보다
늦을 수 없고 quiet window는 scheduler scan completion 뒤에 시작해야 한다.

## 6. IAM raw evidence와 policy 분석

역할 이름 패턴이나 principal regex를 사용하지 않는다. source contract는
`daegu-miami-production`과 승인된 exact project number `884850632328`을 하나의
pinned project identity로 결합한다. Compute Engine 기본 service account는 이
number에서
`serviceAccount:884850632328-compute@developer.gserviceaccount.com`으로만
파생한다. 다른 principal은 승인 receipt의 exact full member를 사용한다.

- approval receipt가 다섯 semantic principal의 production full member와 아래
  policy schema를 exact allowlist로 승인한다.
- provider adapter는 direct/inherited binding의 attachment point/member/role/
  condition, deny policy와 evaluation, group expansion path/completeness,
  impersonation evidence를 원형 보존한다.
- 현재 승인된 attachment scope는 direct
  `projects/daegu-miami-production`(`inherited: false`)뿐이다. 승인된 org/folder
  lineage가 없으므로 inherited 또는 foreign attachment는 거부한다.
- condition boolean snapshot만으로 write 부재를 증명할 수 없다. 현재 계약은
  read-only condition도 보수적으로 거부하며 `conditionEvaluations` exact family는
  비어 있어야 한다.
- public/group/service account/기타 identity를 가리지 않고 write-capable role이
  binding에 존재하면 active/conditional 여부와 관계없이 거부한다. inactive future
  executor는 승인 schema에만 존재하고 provider binding은 없어야 한다.
- 35개 Function runtime service-account inventory, role definition과 complete
  permission expansion, permission universe를 포함한다.
- versioned writable-permission derivation은 permission universe digest,
  writable/read-only exact set을 포함하고 verifier가 다시 계산한다.
- versioned IAM family completeness는 bindings, conditionEvaluations,
  denyPolicies, denyEvaluations, groupExpansions, impersonationEvidence,
  principals, roleDefinitions, runtimeServiceAccounts의 exact family 이름,
  actual/expected count와 family별 canonical digest를 검증한다.
- expected count/digest는 observed array에서 자체 생성해 신뢰하지 않는다.
  approval receipt의 `resources.iamExpectedState`가 독립 root-of-trust이며 provider
  family observation의 count/digest 및 전체 raw policy digest가 모두 이 승인값과
  일치해야 한다.
- evidence IAM principal set, approval receipt allowlist, provider observation은
  member를 포함해 canonical exact 비교한다.
- `cloud_functions_runtime`: `academy_backend_read_only`, `ACTIVE_READ_ONLY`
- `firebase_admin_backend`: `academy_backend_read_only`, `ACTIVE_READ_ONLY`
- `private_writer_runtime`: exact Writer SA, `ACTIVE_READ_ONLY`
- `private_preview_runtime`: exact Preview SA, `ACTIVE_READ_ONLY`
- `future_reset_executor`: `academy_reset_delete_only_inactive`, `INACTIVE`
- active backend/runtime 4개: datastore read 3개만
- future executor: 같은 read 3개와 delete만; create/update/Auth 없음
- future executor는 direct 또는 group-derived binding이 어떤 role로도 존재하면
  안 된다. read-only role도 active binding이면 거부한다.
- Auth effective permission은 다섯 principal 모두 exact empty set

Runtime IAM state contract는 `steady_state`와 `freeze_active`를 분리한다.
Writer steady profile은 datastore database get, entity create/get/list/update의
exact 5개다. Writer freeze와 Preview의 두 상태는 read-only 3개다. activation
receipt는 Writer steady role 제거, read-only 대체, before/after permission·binding
set digest, exact principal, 관측 시각과 approval을 증명해야 한다.
unknown/inherited/conditional writable permission, Preview write, Writer freeze
write는 모두 fail closed다.
Unfreeze restoration은 `jitStartsAt <= iamRestoredAt <= schedulerRestoredAt <=
sentinelDeactivatedAt <= positiveSmokeAt <= observedAt < jitExpiresAt`을 actual
RFC3339 UTC timestamp에서 재계산한다. JIT 시작은 inclusive, 만료는 exclusive다.
1~9자리 fractional second는 BigInt signed epoch-nanoseconds로 변환하며 보안 비교에
`Date.parse()` millisecond 값을 사용하지 않는다. exact 2시간
`7200000000000ns`는 허용하고 1ns라도 초과하면 거부한다. original timestamp,
derived epoch-nanoseconds decimal, duration decimal, exact chronology profile은
approval/transition digest와 Runtime IAM contract digest에 bind한다. 단계 순서가
맞아도 한 단계가 JIT 밖이거나 observation 이후면 receipt를 거부한다.

Build 권한은 project-level Build Core 2-permission profile과 exact source/upload
bucket bindings, exact Artifact Registry repository binding으로 분리한다. Deploy
profile은 승인된 9개 permission만 허용하며 update/delete/IAM/SA-key/Scheduler/API/
Firestore/Auth mutation은 0이어야 한다. Function create의 이름별 IAM 제한 부재는
immutable release/source/selector/baseline digest, 세 Function 순차 배포, 매 단계
Function/Build/Run/source identity 검증, final 35/35 inventory, 검증 후 invoker 공개,
temporary binding 제거와 secure audit artifact를 모두 요구하는 compensating
control로 보완한다.
현재 세 target은 exact HTTP callable이다. Cloud Functions raw provider record에
`eventTrigger` own-property가 object, empty object, `null` 또는 어떤 값으로든
존재하면 projection 전에 전체 observation을 거부한다. 정상 record에는
HTTP callable trigger contract와 `eventTrigger` absence evidence를 기록하며
function inventory digest가 이를 bind한다. Eventarc review 없이 event trigger나
Service Agent binding을 허용하지 않는다.

실행 approval은 `operatorMode`를 필수로 요구하며 누락 시 fail closed다.
`THREE_PERSON_SEPARATION`은 `provisioningPrincipal`,
`impersonationPrincipal`, `invokerOperatorPrincipal`에 서로 다른 세 strict ASCII
dot-atom `user:<email>`을 요구하고 기존 최대 2시간 JIT 의미를 유지한다.
`SINGLE_OPERATOR_JIT_V1`에서만 source-authoritative approved principal
`user:miamidaegu@gmail.com`의 exact 동일 tuple을 허용한다. 다른 user, alias,
group/domain/serviceAccount/wildcard, placeholder, trim, lowercase 또는 Unicode
normalization은 모두 거부하며 source default로 principal을 삽입하지 않는다.

단독 운영자 모드는 contract base release
`d93ea87b68fa2fb8b9623f418e9a1bf2a3ac1297`, exact 13-step order, rollback
manifest, secure audit artifact, temporary-access removal plan과 mode/version을
approval digest에 bind한다. 별도 Production approval reference digest가 없으면
local mutation-command publication도 거부한다. `jitStartsAt`, `jitExpiresAt`은 receipt 필수 exact
RFC3339 UTC이고 start inclusive, expiry exclusive, 최대 60분이다. private
validation completion과 invoker-publication confirmation은 별도 receipt이며
publication 시각은 private validation 이후여야 한다. public 적용 후
TokenCreator/actAs/Deploy binding 제거 evidence와 final permission/key/inventory
audit까지 같은 JIT 안에서 완료해야 한다. 어느 receipt나 control이 빠져도
command publication은 fail closed다. 두 모드 모두 exact 네 Service Account
identity의 complete key audit와 user-managed key count `0`을 receipt에 bind한다.

Organization Policy는 receipt-local generic `ALLOW`를 신뢰하지 않고 canonical
evidence version/digest/status와 direct/effective record count/digest를 포함한
pinned lineage와 exact 비교한다. authoritative 상태는
`OBSERVED_COMPATIBLE_WITH_EXPLICIT_CONTROLS`이며 API enabled, direct policy
`0/4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`,
effective policy
`21/8fb48d51692619032166d4d8e60ea504f7973421d9e420f4a41ca5572987eb99`
이다. 193-constraint catalog digest는 audit metadata일 뿐 eligibility를 바꾸지
않는다. 이 호환성만으로 actual provisioning, deployment/public-invoker approval,
IAM mutation command publication 또는 proof publication을 true로 만들지 않는다.
exact principals/JIT/key audit/source binding/permission audit/compensating control이
모두 receipt에서 승인되어야 한다.

capability는 evidence claim이 아니라 exact effective Firestore/Auth permissions에서
derive한다. receipt/provider/evidence가 서로 일치하더라도 pinned project ID/number
또는 파생된 Compute member와 다르면 거부한다. 한쪽이라도 다른 project identity
또는 member를 반환하거나 unknown/duplicate principal, unknown group/domain,
불완전 group/role expansion, unknown role/permission, condition/deny mismatch,
write-capable `allUsers`/`allAuthenticatedUsers` binding이 있어도 거부한다.
IAM raw policy digest와 principal snapshot digest는 canonical input에서 재계산한다.
문자열 형식만 확인하지 않는다. proof에는 project identity
contract version, exact ID/number, principal policy version/digest, expected와
observed principal member/permission/disposition exact set을 포함한다.
`iamPolicy.observedAt`은 전체 exact inventory가 이 상태임을 관측한 시각이다.

## 7. Exact negative probes

기존 9개 probe를 모두 유지한다.

1. target admin client create
2. target student client update
3. non-transaction callable
4. transaction callable
5. scheduled writer guard
6. backend create
7. backend update
8. backend delete
9. Auth mutation

각 probe는 id/layer/principal/operation/collection/top-level synthetic target/
denial code뿐 아니라 exact provider, provider API generation/version, adapter ID,
실제 entrypoint, target project/academy, sentinel generation/version에 bind한다.
Firestore/Functions는 기존 `permission-denied`/`failed-precondition` 의미를
유지하며 모든 결과가 `denied: true`여야 한다. 실제 사용자 문서나 catch-all
subcollection을 probe하지 않는다.
각 probe의 `evidenceDigest`도 그 필드 자체를 제외한 전체 probe fields에서
verifier가 재계산한다.

## 8. 필수 activation order

quiet window 시작/종료에는 120초 이상 간격이 필요하다. 그 밖의 인접 단계는
동등 timestamp를 허용하지만 역전은 허용하지 않는다.
public `validateWriteFreezeEvidence()` 경로도
`academy_reset_write_freeze_exact_chronology.v1` profile에서 private Runtime IAM의
exact RFC3339 parser를 재사용한다. 모든 최종 보안 비교는 signed epoch-nanoseconds
`BigInt`로 수행하며 `Date.parse()` millisecond 절삭을 사용하지 않는다. freeze
start는 inclusive, expiry는 exclusive라서 `verifiedAt === expiresAt`과 1ns 단계
역전을 모두 거부한다. proof의 activation chronology digest는 각 original RFC3339
문자열과 derived epoch-nanoseconds decimal을 함께 결합한다.

```text
latestDeploymentObservedAt <= latestDeploymentScanCompletedAt
                           <= freezeWindow.activatedAt <= sentinel
                           <= schedulerStopped <= quietWindowEndedAt
                           <= iamReadOnly <= probes <= verifiedAt
```

- `latestDeploymentObservedAt`: Rules/Functions provider resource update time 중
  가장 늦은 authoritative 시각(전체 provider `observedAt`은 포함하지 않음)
- `latestDeploymentScanCompletedAt`: Rules/Functions completeness scan 중 늦은
  완료 시각
- `freezeWindow.activatedAt`: deployment 검증 이후 sentinel 활성화를 시작한 시각
- `sentinel`: target generation/version active 관측 시각
- `schedulerStopped`: exact scheduler set disabled 및 ingress 차단 시각
- `quietWindowEndedAt`: bounded quiet window와 모든 class counter 0 확인 시각
- `iamReadOnly`: 중앙 IAM exact allowlist 상태 관측 시각
- `probes`: 9개 실제 denial 관측 시각
- `verifiedAt`: 위 증거를 최종 검증한 시각

resource update는 해당 family scan과 전체 provider observation보다 늦을 수 없고,
전체 provider observation은 `verifiedAt`보다 늦을 수 없다. approval receipt는
freeze activation 전에 승인되어 `verifiedAt`까지 유효해야 한다. sentinel 이후
증거는 freeze window 안에 있어야 한다.

## 9. Dependency와 local verifier/proof

현재 범위는 Stage A의 declarative operation registry/approval binding, Stage B의
generic read-only HTTP transport, 그리고 mock-only family adapter/verifier
통합과 local-only pre-freeze Production observer까지다. direct
`google-auth-library@10.6.2`와 Node 24 native fetch를 사용하지만 기존 public
transport/adapter API는 계속 mock-only다. Production executor/auth factory/raw
result attestation은 observer authority module 내부에만 있고 export하지 않는다.
이번 구현·테스트에서는 실제 provider observation, credential/token 취득, 배포 또는
mutation을 실행하지 않았다.
dependency provenance는 다음 단일 전략만 승인한다.

- strategy: `declared_google_auth_library_rest`
- transport: `google_auth_library_native_fetch_v1`
- auth dependency: `google-auth-library@10.6.2`
- HTTP runtime: `node24_native_fetch`
- adapter contract: `academy_reset_freeze_provider_adapter.v8`
- no-mutation operation count: `0`

`firebase_cli_private`, transitive-only dependency, private API, unknown 전략은
거부한다. Stage B transport는 v6 registry의 exact 30개 public
read/semantic-read operation
allowlist만 사용할 수 있다. renderer-ready path placeholder, target project/region,
lineage binding, path encoding, query serialization을 임의 caller 값으로 우회할 수
없다. 이 30개는 필수 29개와 선택 진단 1개의 immutable classification partition으로
검증한다. Policy Troubleshooter의 target 없는 `iam:troubleshoot` POST는
`fullResourceName`을 승인/관찰 resource inventory에, `principal`을 승인 IAM
principal/group lineage에, `permission`을 검토된 permission universe에 각각
결합해야 하지만 선택 진단일 뿐이다. adapter source digest, lock digest,
strategy/module/operation set/version/digest, classification version/digest/29+1
count와 permission manifest version/digest/evidence/research SHA/effective set/source
linkage는 approval receipt에 먼저 승인되고 provider dependency observation과 exact
결합되어야 한다.
mock adapter는 호출자가 path/query/body 계획이나 binding 배열을 넘기는 표면을
제공하지 않는다. immutable approval receipt, literal reviewed-source identities,
`metadata.mockOnly === true`인 transport executor만 받으며 executor session
receipt와 approval receipt를 canonical exact 비교한다. operation 순서와 동적
resource lineage는 adapter의 private `WeakMap` session이 소유한다.
adapter와 그 결과는 각각 private `WeakSet` attestation을 통과해야 하며 clone,
duck-typed adapter, 같은 필드를 coherent하게 재작성한 result/context는 public
validation 및 proof API에서 거부한다. verifier가 사용하는 canonical
`repositoryRoot`와 adapter source root가 다르면 observation 전에 거부한다.
Function raw provider record는 canonical projection 전에 shared
`academy_reset_function_http_trigger.v2` contract로 검사한다. `functions.list`와
`functions.get` raw record를 모두 projection 전에 검사하며, `eventTrigger`
own-property는 값이 object, empty, null, undefined인지와 무관하게 전체 observation을
거부한다. Adapter output은 list/GET 각각의 exact 35개 Function keyset, raw count,
eventTrigger own-property count 0, list/GET parity digest, trigger contract ID/digest,
order-insensitive Function-name set digest와 canonical inventory digest를
`academy_reset_function_trigger_absence_evidence.v2` evidence digest로 결합한다.
이 evidence가 누락되거나 stale이면 genuine result와 downstream proof validation이
모두 실패한다.

production executor factory는 호출별 `bindingContext`, fetch, auth, clock, sleep,
timeout 주입을 받지 않는다. 고정 Production identity, 명시적 credential JSON을
받는 lazy `GoogleAuth({credentials, scopes})`, module-load 시 캡처한 Node 24 native
fetch만 사용한다. 동적 resource lineage는 raw family observer가 검증된 provider
응답에서만 파생하며 caller 문자열로 주입할 수 없다.
테스트 factory만 immutable canonical mock receipt를 받고 모든 결과에
`mockOnly: true`를 표시한다. mock family adapter 결과도 `actualMutations: 0`,
`mutationOperationCount: 0`, `unknownOperationCount: 0`, central descriptor에서
재계산한 exact executed-operation subset/count와 canonical execution-trace
digest를 포함한다. read-only semantic POST는 mutation으로 세지 않는다.

단일 exhaustive pagination 결과의 `paginationComplete: true`는 page token 소진만
뜻하며 provider observation의 `complete`가 아니다. stable inventory helper는 서로
다른 `transportExecutionId`를 가진 두 번의 독립 exhaustive 실행 결과만 비교한다.
family adapter가 이 stable pair를 approval inventory와 결합하기 전에는 observation
completeness를 주장할 수 없다.

별도 reviewed-source contract는 package/lock, Runtime IAM/Build scope contract,
operation registry, transport, mock adapter, attestation, read-only permission
manifest, runtime Git identity resolver, write-freeze contract, local-only Production
observer, verifier의 exact 13개 path와 각 파일의 literal
SHA-256 및 canonical aggregate digest를 approval metadata/session/observation/proof에
결합한다. 이 local adapter source set은 기존 deployed runtime Git critical source
목록에 추가하지 않는다. adapter/verifier는 이 registry 자체는 hash set에서
제외하고, exact 13개 runtime path를 `lstat`/`realpath`로 regular non-symlink인지
확인한 뒤 bytes SHA-256와 literal pin 및 aggregate를 다시 계산한다.
reviewed-source aggregate는 source pin registry의 canonical digest를 검증 시점에
재계산하며 문서의 복사값을 승인 근거로 사용하지 않는다.

증명용 runtime context는 동일한 canonical repository root에서 genuine mock
adapter/result와 reviewed-source identity를 검증한 뒤, clean Git HEAD/tree,
tracked regular HEAD blobs, 안전한 index flags, runtime bytes와 HEAD bytes의
동일성까지 직접 재검증한다. 호출자가 전달한 SHA나 Git identity 객체는 context
생성 입력으로 받지 않는다.

permission manifest는 OAuth scope와 IAM permission을 구분한다. OAuth scope는 token이
API를 호출할 수 있는 범위일 뿐 resource authorization을 증명하지 않으므로,
mandatory operation은 공식 IAM 근거와 exact `requiredIamPermissions`가 있어야 한다.
필수 29개의 effective contract는 required/conditional/auxiliary/OAuth exact set,
각 값에서 source operation으로 가는 linkage, official/reviewed evidence digest,
research artifact SHA를 모두 결합한다.

### Production Observer standalone project profile

Production target `daegu-miami-production` (`884850632328`)은 organization과 folder
parent가 없는 standalone project다. canonical `projects.get` evidence의 `parent`는
명시적 `null`이어야 하며 folder/organization observed set은 모두 empty여야 한다.
raw API가 `parent`를 생략할 때만 provider canonicalizer가 schema 검증 후 `null`로
변환한다. canonical evidence의 missing/undefined/string/object parent, 관찰된
folder/organization, 다른 project/source identity는 모두 거부한다.

versioned profile은
`academy_reset_observer_topology_profile.v3` /
`standalone_project_v1`이며 profile SHA-256은
`421b57feb0e66f021e00a95932004e0a373a561d62c1577d84e41bdedd7eb30e`,
topology evidence SHA-256은
`d38dc2cda3d7eaaf5c2364ccbd3938584a158efd1df21cc30f0c38111856ef3a`다.
Observer가 읽는 Functions source bucket은
`gcf-v2-sources-884850632328-us-central1`, owner project number는 target과 같은
`884850632328`이다. Observer read-only role에는 별도 bucket binding을 추가하지
않는다. dedicated Build identity에는 source/upload bucket 각각의
`roles/storage.objectViewer`와 exact `gcf-artifacts` repository의
`roles/artifactregistry.writer`만 허용한다. project-wide Storage/Artifact Registry
binding은 거부한다. owner는 bucket 이름에서
추출하지 않는다. exact `storage.v1.buckets.get` GET
`/storage/v1/b/{bucket}?projection=noAcl` 응답의 `name`, string `projectNumber`,
`location`, `storageClass`를 관찰하고 Functions source provenance와 response/identity
digest에 결합한다. `response.name` 또는 `projectNumber` 불일치, 필드 누락·null·잘못된
타입, unknown/external bucket은 거부한다.

operation registry 30개와 mandatory 29 / optional diagnostic 1 분류를 사용한다.
standalone topology의 capability profile은 exact 25 executed와 아래 exact 4
topology-derived N/A다. 모든 deny-policy list가 pagination-complete exact empty이면
`iam.v2.policies.denypolicies.get`을 raw list evidence에서 파생한 추가 N/A로 분류하여
actual execution profile은 24 executed / 5 N/A가 된다. deny policy가 하나라도
있으면 GET은 executed로 유지되고 listed/GET policy keyset 전체를 분석한다.

genuine Observer는 IAM을 두 번 scan한다. 각 scan은 독립된 operation trace,
executed set, topology-derived N/A, evidence-derived N/A accumulator를 사용한다.
같은 scan 안 N/A 중복은 거부하고, scan 간에는 volatile execution ID와 관찰 시각을
제외한 exact IAM state, operation set, N/A reason/prerequisite/parent/keyset의
canonical semantic digest가 같아야 한다. 첫 scan의 coverage/N/A와 두 scan의 trace를
최종 evidence에 결합하며, empty/nonempty deny profile 또는 동일 count operation
swap이 발생하면 unstable inventory로 거부한다.

- `cloudresourcemanager.v3.folders.get`
- `cloudresourcemanager.v3.folders.getIamPolicy`
- `cloudresourcemanager.v3.organizations.get`
- `cloudresourcemanager.v3.organizations.getIamPolicy`

caller가 N/A set/count/digest를 지정할 수 없다. verifier는 canonical topology와
pagination-complete raw deny list evidence에서 이를 다시 파생하며 executed와 N/A의
union은 mandatory 29 exact set, intersection은 empty여야 한다. empty-deny fixture의
executed set SHA-256은
`7641f8ac62b01e490fc65c2c30e973154d0f89b103b5c4e3ac1fe4503e706a32`,
N/A set SHA-256은
`33be1a9a9fcf09c3e84de9cd09d11bc71a405368774fcbbbcdc4a78b69c3a65a`다.
operation execution profile version은
`academy_reset_observer_operation_execution.v3`; base capability profile SHA-256은
`96aae621f4a9cc1859ca360b7cf442b05a0fd81d627241be9709c3b6c5121f34`,
empty-deny actual profile SHA-256은
`710380c61c7ffe559ac7bde97f7d2e156441be0c877eea5bbb81bd43a76dc772`다.

standalone project-level custom role은 records에서 재계산된 required 26와 auxiliary
`serviceusage.services.use` 1개, 총 27개 exact permission만 사용한다.
추가 required permission은 `storage.buckets.get`이다.
`resourcemanager.folders.*`, `resourcemanager.organizations.*`,
`storage.objects.getIamPolicy`, Policy Troubleshooter 관련 permission, mutation 및
privilege-escalation permission은 effective role에서 제외한다.
`storage.objects.getIamPolicy`는 reviewed conditional evidence에는 남지만 현재
`noAcl` observer 호출과 standalone role에는 포함하지 않는다.
required/auxiliary/effective-role set SHA-256은 각각
`b6f7fc149537ddc6d3cce1a7dabe767e32157751f6b67fdbb2dde0e822e57916`,
`c06c225b90be798853d9eed58bec19be14a84d026ea1432cd32984be9448d2a1`,
`9ecb5fbe293958a368399c24f637ecc9deba49f82ad155cf4ab24a759621f099`다.
effective permission profile version은
`academy_reset_observer_permission_profile.v2`, 전체 profile SHA-256은
`0b39531d3db4174dc56551760acc82655276a2d26e010297ec929d465d4bf050`다.

raw operation trace는 event count와 별도로 unique operation ID set, mandatory/optional
partition, per-operation event count 및 각 digest를 재계산한다. trace-derived mandatory
set은 evidence-derived actual executed set(deny list empty면 24, nonempty면 25)과
같아야 한다. N/A operation, optional diagnostic 또는
unknown operation이 mandatory coverage를 대신할 수 없다. 실제 observer는 안정성
double-scan 때문에 같은 operation ID의 여러 bounded event를 가질 수 있으나 unique
coverage에는 한 번만 반영한다.

Observer principal policy
`academy_reset_observer_principal.v1`의 exact identity는 다음과 같다.

- service-account ID: `academy-reset-freeze-observer`
- email:
  `academy-reset-freeze-observer@daegu-miami-production.iam.gserviceaccount.com`
- member:
  `serviceAccount:academy-reset-freeze-observer@daegu-miami-production.iam.gserviceaccount.com`

principal policy SHA-256은
`e3f271d6d4eb10f4d484d496eb675ca9186b3382084b4c12a263c4cb3ca142f9`다.

credential `client_email`은 trim/lowercase/domain/prefix/suffix normalization 없이
위 email과 byte-for-byte 일치해야 한다. 기존 Firebase Admin 또는 reset
planner/executor credential 재사용은 금지한다. key ID, `private_key_id`,
`client_id`는 rotation을 위해 pin하지 않는다.

local preflight는 target project → release/source → topology profile →
operation/permission profile → principal policy → output security 순서로 통과한
뒤에만 credential file을 읽는다. file security → JSON schema → credential
`project_id` → exact `client_email` 검증 후에만 GoogleAuth를 생성할 수 있다.
prior gate 실패 시 credential private material read, GoogleAuth creation, Provider
call, output은 모두 0이다.

이 변경은 IAM role/service account/key/binding을 생성하지 않는다. 실제 IAM
provisioning은 후속 독립 승인 대상이다. inventory에 누락된
`createFixedPrivateLessonAssignment`,
`previewFixedPrivateLessonOutcomeAction`,
`commitFixedPrivateLessonOutcomeAction` 배포도 별도 deployment gate이며 이 profile
승인으로 허용되지 않는다.

Cloud Storage object metadata는 registry가 `projection` query를 노출하지 않아 공식
기본값 `noAcl`로 동작한다. 따라서 `storage.objects.get`은 required이고
`storage.objects.getIamPolicy`는 ACL 반환 시에만 conditional이며 현재 mandatory
required set에는 포함되지 않는다. Cloud Asset `analyzeIamPolicy`의
`iam.roles.get`도 custom-role expansion이 실제 필요한 경우에만 conditional이다.

mock observation에 필요한 read-only 권한은 operation family별로 다음과 같다.

- Rules: release/ruleset get
- Functions/Run/Build/Storage: 시작/종료 Functions list와 각 Function get,
  시작/종료 Run services list 및 서비스별 revisions list/get, terminal
  `SUCCESS` Build get, exact noAcl Storage bucket metadata get,
  generation-pinned Storage object metadata/media get. bucket owner/location/
  storage class와 object metadata의
  MD5/size와 transport가 media bytes에서 계산한 MD5/SHA-256/byte length가 exact
  일치해야 한다.
- Resource Manager/IAM: project 및 발견된 folder/org get/getIamPolicy, role 및
  service account list/get/getIamPolicy, deny policy list/get
- IAM analysis: 필수 Cloud Asset analyzeIamPolicy; 선택 진단 Policy Troubleshooter
  troubleshoot
- Scheduler/Service Usage: jobs list/get, services get

IAM mandatory pass는 Resource Manager, bindings, roles, service accounts,
Cloud Asset, deny policy, Service Usage를 포함한 전체 pass를 두 번 새로 실행한다.
service-account inventory는 승인 principal/runtime set과 exact해야 하며 각 account의
get/getIamPolicy를 두 pass 모두 수행한다. 승인 group/domain도 각각 별도
`fullyExplored` Cloud Asset 분석과 raw `analysisResults`/`groupEdges` 증거가 있어야
하며, 빈 결과를 synthetic completeness로 대체하지 않는다. Scheduler도 list와 모든
job get을 시작/종료에 각각 실행해 full canonical snapshot을 비교한다.
active IAM binding이 reviewed delete/writable permission을 포함하면 알려진 role이라도
`policyAnalysisComplete: false`이며 blocker다.
Resource Manager project/folder/organization 정책과 각 service account
`getIamPolicy` binding은 하나의 canonical binding universe로 합친다. 각 record는
exact resource type/name, policy source, direct/inherited state, member, role,
condition, expanded permissions 및 expansion digest를 결합한다. raw nested policy를
caller의 top-level binding/count/digest보다 우선해 재계산하며 unknown scope/role/
principal/permission, unresolved condition, duplicate 또는 writable binding은 모두
fail closed다.
Resource Manager attachment는 target project의 provider-observed parent chain에
실제로 존재하는 exact project/folder/organization resource만 허용한다. hierarchy의
누락·중복·단절·순환·parent/type/depth/digest 불일치와 관찰되지 않은 문법상 유효한
folder/organization도 거부한다. 각 service account는 full resource name의 마지막
identifier와 exact email, project segment, unique ID 및 nested policy attachment를
서로 결합한다. hierarchy 및 service-account resource identity digest는 canonical
binding identity와 binding-set digest에 포함되며 배열 순서에는 독립적이다.
Policy Troubleshooter를 선택 실행한다면 mandatory observation과 분리된 out-of-band
진단 채널을 사용해야 한다. mandatory provider result의 operation ID, trace,
observation digest 또는 proof bytes에 Troubleshooter 결과를 섞으면 contract가
거부한다. 누락·실패·불완전은 mandatory completeness를 바꾸지 않으며, 어떤
Troubleshooter 결과도 proof gate를 true로 만들거나 mandatory proof input이 될 수
없다.
Service Account list/get의 full resource name과 Scheduler get의 full job name도
요청한 target project/location/email/job allowlist와 exact 일치해야 한다.

실제 token, Authorization header, service-account key, ADC path 또는 credential
artifact는 adapter input/output/proof에 포함하지 않는다. local-only Production
observer는 구현됐지만 이번 단계에서는 injected mock dependencies로만 검증했다.
실제 실행에는 별도 Production read-only 승인, observer가 병합된 exact release SHA,
명시적 credential path와 exact confirmation이 필요하다. ADC,
`GOOGLE_APPLICATION_CREDENTIALS`, user OAuth, gcloud credential 또는 default
project fallback은 사용하지 않는다.

observer credential은 명시적 absolute path의 regular non-symlink file만 허용하고
mode `0600`, 현재 사용자 owner, JSON object, exact
`project_id=daegu-miami-production`을 확인한다. 모든 CLI/project/release/source/output
guard가 성공한 후에만 credential을 읽고 GoogleAuth를 생성한다. credential path,
private key, client email/client ID, token/header는 오류나 artifact에 기록하지 않는다.

향후 별도 승인된 read-only observation 명령 계약은 다음과 같다. 아래 명령은 이번
구현 또는 테스트에서 실행하지 않았다.

```sh
CONFIRM_PRODUCTION_READ_ONLY_OBSERVATION=YES \
node functions/scripts/observe-academy-reset-freeze-production.mjs \
  --project=daegu-miami-production \
  --project-number=884850632328 \
  --release-sha=<merged-observer-release-sha> \
  --credential-file=/absolute/local/credential.json \
  --summary-output=/absolute/new-output/provider-observation-summary-redacted.json \
  --sensitive-output=/absolute/new-output/provider-observation-sensitive.json
```

Policy Troubleshooter는 기본 비활성이다. 요청할 때만
`--optional-diagnostic=policytroubleshooter.v3.iam.troubleshoot`를 exact하게 추가한다.
그 결과는 mandatory 29개 observation, `providerObservationComplete`,
`policyAnalysisComplete`, proof bytes 또는 write-freeze gate를 대체하지 않는다.

두 output은 current-user 소유 mode `0700` secure base 아래의 동일한 신규 고유
directory에 생성한다. base device/inode를 preflight부터 publication까지 결합하고
생성 directory device/inode도 각 temp/link/unlink 전후에 재검증한다. directory는
`0700`, final
regular files는 `0600`이며 symlink/intermediate symlink, repository 또는 `.git`
내부 경로, overwrite를 거부한다. 두 파일은 atomic no-clobber로 게시하고 두 번째
파일 실패 시 첫 파일과 temp 및 새 directory를 rollback한다. redacted summary에는
raw IAM member/resource path를 넣지 않고 count/digest만 기록하며 sensitive output은
local secure storage에만 보관한다.

이 output은 pre-freeze provider observation이지 freeze proof가 아니다. approval
receipt 입력이 없는 observer이므로 `deploymentLineageApproved`,
`drainTelemetryComplete`, `writeFreezeVerified`, `executionEligible`,
`writeAuthorized`는 항상 `false`, `actualMutations`는 항상 `0`이다. 실제 Rules/
Functions deploy, IAM/Scheduler 변경, sentinel freeze, planner, reset은 모두 후속
별도 단계다.

evidence는 저장소 밖 canonical regular file, mode `0600`으로 보관한다. output
parent는 `0700`이며 output은 새 파일만 atomic no-clobber로 `0600` 생성한다.
symlink, 저장소 내부 경로, secret/PII, unknown key는 거부한다.

standalone CLI에는 승인 provider adapter가 없으므로 다음 명령은 schema/path
확인용 우회 수단이 아니며 proof 생성을 거부한다.

```sh
node functions/scripts/verify-academy-reset-write-freeze.mjs \
  --evidence /absolute/external/write-freeze-evidence.json \
  --output /absolute/external/write-freeze-proof.json
```

Production observer CLI는 local repository tool이며 Cloud Function으로
import/export하지 않는다. 테스트는 public Production executor가 아니라
`mockOnly: true`인 exact injected harness만 사용하고 실제 credential file,
GoogleAuth, fetch 또는 Provider API에 접근하지 않는다. observer 결과나 mock
adapter 단독 결과는 proof가 아니고 기존 다섯 proof gate를 우회하거나
`writeFreezeVerified: true`를 만들 수 없다.

성공 proof의 `providerObservationComplete`, `policyAnalysisComplete`,
`drainTelemetryComplete`, `deploymentLineageApproved`, `writeFreezeVerified`는
모두 하위 validator 성공에서 파생된 `true`다. 호환용 self-reported `gateStates`는
파생 결과와 exact 비교할 뿐 신뢰 근거가 아니다. 하위 계약이 실패하면 gate 비교나
proof 출력까지 진행하지 않는다.
proof는 항상 `actualMutations: 0`, `actualWrites: 0`,
`executorImplemented: false`, `advisoryOnly: true`다.
이는 local verifier가 executor/write API를 구현하지 않는다는 계약 동작이지,
임의의 future provider adapter가 side effect를 일으키지 않았다는 독립 증명은
아니다. adapter 자체는 별도 source/lock review와 read-only capability 검증이
필요하다.

## 10. Planner와 reset

proof 성공 후에도 fresh planner, exact proof/release/project/academy binding,
새 독립 승인, 별도 구현·검토된 executor가 모두 필요하다. 기존 planner나
baseline approval을 재사용하지 않는다. 이 runbook 자체는 reset 권한을 주지
않는다.

## Unfreeze 및 rollback exact contract

정상 unfreeze와 reset 취소/rollback은 모두 contract의 같은 machine-readable
순서를 사용한다. 병렬화하거나 이전 순서를 사용하지 않는다.

1. `iamRestore`: Writer exact steady role을 복원하고 Preview read-only와 extra
   permission 0을 확인
2. `schedulerRestore`: 지연/중복 실행 위험을 audit한 뒤 exact job set restore
3. `sentinelDeactivate`: IAM과 scheduler 복구 확인 후 sentinel 비활성화
4. `positiveSmoke`: exact project/academy에서 client/backend/scheduler positive
   smoke와 관측 완료

rollback도 `audit → iamRestore → schedulerRestore → sentinelDeactivate →
positiveSmoke`이다. source/provider/probe/timeline 실패 시 reset으로 전진하지
않고 현재 freeze를 유지한 채 원인을 교정한 다음 새 window, receipt,
observation, IAM/scheduler inventory, 9 probes, proof, planner, 승인을 모두
재수집한다.
