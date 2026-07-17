# Academy reset write-freeze runbook

이 문서는 `daegu-miami-production`의 `academy_daegumiami` reset 전에 필요한
write-freeze 증거 계약만 정의한다. 이 변경은 배포, IAM/scheduler 변경,
sentinel 활성화, probe, planner, reset, unfreeze를 실행하거나 구현하지 않는다.
기존 advisory planner의 `writeFreezeVerified: false`와 comparison-only baseline은
승인 또는 실행 권한이 아니다.

## Fail-closed 고정값

- contract/proof: `academy_reset_write_freeze.v3` /
  `academy_reset_write_freeze_proof.v3`
- Observation Contract: `academy_reset_provider_observation.v3`
- deployment approval/provider dependency:
  `academy_reset_deployment_approval.v3` /
  `academy_reset_provider_dependency.v2`
- project/academy: `daegu-miami-production` / `academy_daegumiami`
- Functions: `us-central1`, `GEN_2`, 35개 exact deployed function set과 별도의
  26개 exact guarded export set
- provider adapter ID/contract:
  `gcp_immutable_resource_observer.v1` /
  `academy_reset_freeze_provider_adapter.v4`
- Stage A provider operation registry:
  `academy_reset_freeze_provider_operations.v4`, exact 29 operations,
  descriptor-set SHA-256
  `2bc2dd2e27252549c3aa7382790ed4e49dc1752a7162bca36b7f0601a7b947e9`
- freeze window: 최대 3600초
- writer source: registry의 literal SHA-256 pin 21개
- reset collection: 29개
- 누락, extra, duplicate, stale, unknown, target mismatch는 상태가 disabled 또는
  read-only처럼 보여도 거부한다.

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
- 각 runtime service account는 approval receipt의 exact IAM member이며
  `ACTIVE_READ_ONLY`, backend read-only exact permission set이어야 함
- IAM raw evidence와 Scheduler provider inventory

Rules API가 local source tree, bundle SHA-256 또는 승인 artifact lineage를
제공한다고 주장하지 않는다. Rules provider observation에는 source bundle
필드가 없다.

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

- approval receipt가 세 semantic principal의 production full member와 아래
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
- `future_reset_executor`: `academy_reset_delete_only_inactive`, `INACTIVE`
- backend 2개: datastore read 3개만
- future executor: 같은 read 3개와 delete만; create/update/Auth 없음
- future executor는 direct 또는 group-derived binding이 어떤 role로도 존재하면
  안 된다. read-only role도 active binding이면 거부한다.
- Auth effective permission은 세 principal 모두 exact empty set

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
통합까지다. direct `google-auth-library@10.6.2`는 functions package/lock에
고정하지만 adapter는 production transport/auth factory를 호출하지 않는다.
실제 provider observation, credential/token 취득, standalone Production CLI,
배포 및 mutation은 구현하지 않았다.
dependency provenance는 다음 단일 전략만 승인한다.

- strategy: `declared_google_auth_library_rest`
- transport: `google_auth_library_native_fetch_v1`
- auth dependency: `google-auth-library@10.6.2`
- HTTP runtime: `node24_native_fetch`
- adapter contract: `academy_reset_freeze_provider_adapter.v4`
- no-mutation operation count: `0`

`firebase_cli_private`, transitive-only dependency, private API, unknown 전략은
거부한다. Stage B transport는 v4 registry의 exact 29개 public
read/semantic-read operation
allowlist만 사용할 수 있다. renderer-ready path placeholder, target project/region,
lineage binding, path encoding, query serialization을 임의 caller 값으로 우회할 수
없다. Policy Troubleshooter의 target 없는 `iam:troubleshoot` POST는
`fullResourceName`을 승인/관찰 resource inventory에, `principal`을 승인 IAM
principal/group lineage에, `permission`을 검토된 permission universe에 각각
결합해야 한다. adapter source digest, lock digest,
strategy/module/operation set/version/digest는 approval receipt에 먼저 승인되고
provider dependency observation과 exact 결합되어야 한다.
mock adapter는 호출자가 path/query/body 계획이나 binding 배열을 넘기는 표면을
제공하지 않는다. immutable approval receipt, literal reviewed-source identities,
`metadata.mockOnly === true`인 transport executor만 받으며 executor session
receipt와 approval receipt를 canonical exact 비교한다. operation 순서와 동적
resource lineage는 adapter의 private `WeakMap` session이 소유한다.
adapter와 그 결과는 각각 private `WeakSet` attestation을 통과해야 하며 clone,
duck-typed adapter, 같은 필드를 coherent하게 재작성한 result/context는 public
validation 및 proof API에서 거부한다. verifier가 사용하는 canonical
`repositoryRoot`와 adapter source root가 다르면 observation 전에 거부한다.

production executor factory는 호출별 `bindingContext`, fetch, auth, clock, sleep,
timeout 주입을 받지 않는다. 고정 Production identity와 lazy GoogleAuth/native
fetch만 캡처한다. 동적 resource lineage는 향후 family adapter가 검증된 provider
응답에서 파생해야 하며 현재 production transport에 caller 문자열로 주입할 수 없다.
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

별도 reviewed-source contract는 package/lock, operation registry, transport,
mock adapter, attestation, runtime Git identity resolver, write-freeze contract,
verifier의 exact 9개 path와 각 파일의 literal
SHA-256 및 canonical aggregate digest를 approval metadata/session/observation/proof에
결합한다. 이 local adapter source set은 기존 deployed runtime Git critical source
목록에 추가하지 않는다. adapter/verifier는 이 registry 자체는 hash set에서
제외하고, exact 9개 runtime path를 `lstat`/`realpath`로 regular non-symlink인지
확인한 뒤 bytes SHA-256와 literal pin 및 aggregate를 다시 계산한다.
현재 reviewed-source aggregate는
`3cb8033621888f366db9485d82441d365aa2a4d9f2cb171bc239ada3dbcf44d8`이다.

증명용 runtime context는 동일한 canonical repository root에서 genuine mock
adapter/result와 reviewed-source identity를 검증한 뒤, clean Git HEAD/tree,
tracked regular HEAD blobs, 안전한 index flags, runtime bytes와 HEAD bytes의
동일성까지 직접 재검증한다. 호출자가 전달한 SHA나 Git identity 객체는 context
생성 입력으로 받지 않는다.

mock observation에 필요한 read-only 권한은 operation family별로 다음과 같다.

- Rules: release/ruleset get
- Functions/Run/Build/Storage: 시작/종료 Functions list와 각 Function get,
  시작/종료 Run services list 및 서비스별 revisions list/get, terminal
  `SUCCESS` Build get, generation-pinned Storage metadata/media get. metadata의
  MD5/size와 transport가 media bytes에서 계산한 MD5/SHA-256/byte length가 exact
  일치해야 한다.
- Resource Manager/IAM: project 및 발견된 folder/org get/getIamPolicy, role 및
  service account list/get/getIamPolicy, deny policy list/get
- IAM analysis: Cloud Asset analyzeIamPolicy, Policy Troubleshooter troubleshoot
- Scheduler/Service Usage: jobs list/get, services get

IAM은 Resource Manager, bindings, roles, service accounts, Cloud Asset,
Troubleshooter, deny policy, Service Usage를 포함한 전체 pass를 두 번 새로 실행한다.
service-account inventory는 승인 principal/runtime set과 exact해야 하며 각 account의
get/getIamPolicy를 두 pass 모두 수행한다. 승인 group/domain도 각각 별도
`fullyExplored` Cloud Asset 분석과 raw `analysisResults`/`groupEdges` 증거가 있어야
하며, 빈 결과를 synthetic completeness로 대체하지 않는다. Scheduler도 list와 모든
job get을 시작/종료에 각각 실행해 full canonical snapshot을 비교한다.
Policy Troubleshooter의 expected non-write 결과는 exact `NOT_GRANTED`만 허용한다.
Service Account list/get의 full resource name과 Scheduler get의 full job name도
요청한 target project/location/email/job allowlist와 exact 일치해야 한다.

실제 token, Authorization header, service-account key, ADC path 또는 credential
artifact는 adapter input/output/proof에 포함하지 않는다. Production observation은
별도 구현·source review·권한 승인·approval receipt가 필요하며 이 mock approval을
재사용할 수 없다.

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

Production CLI는 존재하지 않으며 mock adapter를 주입해도 CLI 경로는 거부한다.
programmatic 테스트만 network 없는 mock adapter와 완전한 synthetic sentinel/IAM/
drain/probe evidence를 결합할 수 있다. mock adapter 단독 결과는 proof가 아니고
기존 다섯 proof gate를 우회하거나 `writeFreezeVerified: true`를 만들 수 없다.

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

1. `audit`: reset/취소 결과와 invariants를 독립 audit
2. `iamRestore`: 검토된 IAM policy를 restore하고 effective permission 확인
3. `schedulerRestore`: 지연/중복 실행 위험을 audit한 뒤 exact job set restore
4. `sentinelDeactivate`: IAM과 scheduler 복구 확인 후 sentinel 비활성화
5. `positiveSmoke`: exact project/academy에서 client/backend/scheduler positive
   smoke와 관측 완료

rollback도 `audit → iamRestore → schedulerRestore → sentinelDeactivate →
positiveSmoke`이다. source/provider/probe/timeline 실패 시 reset으로 전진하지
않고 현재 freeze를 유지한 채 원인을 교정한 다음 새 window, receipt,
observation, IAM/scheduler inventory, 9 probes, proof, planner, 승인을 모두
재수집한다.
