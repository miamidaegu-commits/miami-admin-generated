# Academy reset write-freeze runbook

이 문서는 `daegu-miami-production`의 `academy_daegumiami` reset 전에 필요한
write-freeze 증거 계약만 정의한다. 이 변경은 배포, IAM/scheduler 변경,
sentinel 활성화, probe, planner, reset, unfreeze를 실행하거나 구현하지 않는다.
기존 advisory planner의 `writeFreezeVerified: false`와 comparison-only baseline은
승인 또는 실행 권한이 아니다.

## Fail-closed 고정값

- contract/proof: `academy_reset_write_freeze.v2` /
  `academy_reset_write_freeze_proof.v2`
- project/academy: `daegu-miami-production` / `academy_daegumiami`
- Functions: `us-central1`, `GEN_2`, contract의 35개 exact deployed function set
- provider adapter: `gcp_immutable_resource_observer.v1`
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

## 2. 배포와 독립 provider observation

동일 release에서 Rules와 Functions를 배포한 뒤, 배포 주체의 self-report를
evidence에 복사해 신뢰하지 않는다. 승인된 provider adapter가 cloud provider의
immutable resource를 독립 조회해 다음 두 항목을 함께 반환해야 한다.

1. 독립 승인 시스템이 보관한 exact approval receipt
2. provider에서 관측한 immutable Rules/Functions resource 및 IAM observation

operator evidence에는 approval receipt만 포함한다. verifier는 adapter가 반환한
receipt와 evidence receipt를 canonical exact 비교하고, provider observation의
resource 부분과 receipt의 승인 resource 부분을 exact 비교한다. adapter의
`observeDeployment()`는 provider API를 기다리는 async Promise여도 되며 verifier는
반드시 이를 `await`한다. observation이 resolve되기 전에는 proof 파일을 만들지
않는다.

Rules exact identity:

- project, ruleset ID, deployment/release ID, update time
- source bundle bucket/object/generation/SHA-256
- ruleset은 `projects/daegu-miami-production/rulesets/{rulesetId}`,
  release는 `projects/daegu-miami-production/releases/cloud.firestore` exact
  grammar로 parsing하며 foreign/prefix/numeric project segment를 거부
- parsed project와 full Rules resource identity는 proof digest에 포함

Functions exact identity:

- 35개 deployed function name exact set(누락/extra/duplicate 불허)
- 각 function의 project, `us-central1`, `GEN_2`
- revision ID, build ID, update time
- source bundle bucket/object/generation/SHA-256

receipt는 exact project/release, local `firestore.rules`와
`functions/index.js` HEAD SHA-256, writer source identity digest에 bind한다.
또한 production full IAM member를 포함한 exact IAM principal allowlist를
machine-readable하게 포함한다.
단순 `matchesLocal`, 배포 코드의 release self-report, 서로 같은 임의 digest,
콘솔의 “최근 배포” 표시는 통과 근거가 아니다. provider adapter가 없는
standalone CLI는 의도적으로 proof 생성을 거부한다. 승인된 adapter를 주입하는
검토된 programmatic entrypoint만 proof를 만들 수 있다.

## 3. Sentinel 활성화

별도 승인 절차로 `academies/academy_daegumiami.resetWriteFreeze`를 활성화한다.
증거에는 exact provider/project/academy/document/field/mode/schema,
`writeFreezeActive: true`, 양의 integer generation, immutable version timestamp,
snapshot digest, writer registry digest가 필요하다.

`freezeWindow.activatedAt`은 sentinel 활성화 시작이고 `sentinel.capturedAt`은
그 generation/version이 active임을 관측한 시각이다.

## 4. Scheduler 중지와 drain

중앙 `SCHEDULER_JOB_ALLOWLIST`와 provider inventory가 exact 일치해야 한다.
현재 job은 `autoDeductPendingLessons` 하나이며 project, region, target이 모두
고정된다. unknown disabled job도 거부한다.

- `scheduler.stoppedAt`: exact writer job set을 disabled하고 callable 및
  Auth/provisioning ingress를 차단한 시각
- `scheduler.drainedAt`: stopped 이후 job/callable/Auth in-flight가 모두 0임을
  확인한 시각
- 각 job: exact name/project/region/target, `DISABLED`,
  `inFlightExecutions: 0`, evidence digest
- inventory complete와 전체 drain evidence digest 필수

## 5. IAM read-only 관측

역할 이름 패턴이나 principal regex를 사용하지 않는다. source contract는
`daegu-miami-production`과 승인된 exact project number `884850632328`을 하나의
pinned project identity로 결합한다. Compute Engine 기본 service account는 이
number에서
`serviceAccount:884850632328-compute@developer.gserviceaccount.com`으로만
파생한다. 다른 principal은 승인 receipt의 exact full member를 사용한다.

- approval receipt가 세 semantic principal의 production full member와 아래
  policy schema를 exact allowlist로 승인한다.
- provider adapter가 IAM API에서 full member, effective Firestore/Auth
  permissions, disposition을 독립 관측한다.
- evidence IAM principal set, approval receipt allowlist, provider observation은
  member를 포함해 canonical exact 비교한다.
- `cloud_functions_runtime`: `academy_backend_read_only`, `ACTIVE_READ_ONLY`
- `firebase_admin_backend`: `academy_backend_read_only`, `ACTIVE_READ_ONLY`
- `future_reset_executor`: `academy_reset_delete_only_inactive`, `INACTIVE`
- backend 2개: datastore read 3개만
- future executor: 같은 read 3개와 delete만; create/update/Auth 없음
- Auth effective permission은 세 principal 모두 exact empty set

capability는 evidence claim이 아니라 exact effective Firestore/Auth permissions에서
derive한다. receipt/provider/evidence가 서로 일치하더라도 pinned project ID/number
또는 파생된 Compute member와 다르면 거부한다. 한쪽이라도 다른 project identity
또는 member를 반환하거나 unknown/duplicate principal, wildcard member, unknown
permission, writable capability가 있어도 거부한다. proof에는 project identity
contract version, exact ID/number, principal policy version/digest, expected와
observed principal member/permission/disposition exact set을 포함한다.
`iamPolicy.readOnlyObservedAt`은 전체 exact inventory가 이 상태임을 관측한 시각이다.

## 6. Exact negative probes

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

## 7. 필수 activation order

동등 timestamp는 허용하지만 역전은 허용하지 않는다.

```text
latestDeploymentObservedAt <= freezeWindow.activatedAt <= sentinel
                           <= schedulerStopped <= drained
                           <= iamReadOnly <= probes <= verifiedAt
```

- `latestDeploymentObservedAt`: 승인 adapter의 observation 시각과 모든 Rules/
  Functions immutable resource update time 중 가장 늦은 authoritative 시각
- `freezeWindow.activatedAt`: deployment 검증 이후 sentinel 활성화를 시작한 시각
- `sentinel`: target generation/version active 관측 시각
- `schedulerStopped`: exact scheduler set disabled 및 ingress 차단 시각
- `drained`: 모든 in-flight 0 관측 시각
- `iamReadOnly`: 중앙 IAM exact allowlist 상태 관측 시각
- `probes`: 9개 실제 denial 관측 시각
- `verifiedAt`: 위 증거를 최종 검증한 시각

resource update는 deployment observation보다 늦을 수 없고, approval receipt는
deployment 전에 승인되어 `verifiedAt`까지 유효해야 한다. sentinel 이후 증거는
freeze window 안에 있어야 한다.

## 8. Local verifier와 proof

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

실제 proof 생성은 승인 adapter를 주입하는 별도 검토된 wrapper가
`verifyLocalWriteFreezeEvidence`를 호출해야 한다. 테스트는 network 없는 mock
adapter만 사용한다.

## 9. Planner와 reset

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
