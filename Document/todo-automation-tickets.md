# Harness TODO Automation Tickets

이 문서는 `todo.md`의 자동 진행 범위를 독립적으로 구현하고 검증할 수 있는 티켓으로 나눈 실행 기준이다. `진행하면 좋은 것들 (자동 진행 대상 아님)`의 Worktree 개발 서버 Preview는 포함하지 않는다.

## 공통 완료 규칙

- 각 티켓은 관련 코드, 테스트, 문서와 `todo.md` 체크박스를 함께 갱신한다.
- 각 티켓마다 `pnpm typecheck`, 관련 동작 테스트, `pnpm build`를 통과한다.
- 변경 diff와 Git 상태를 검토한 뒤 해당 티켓 파일만 별도 커밋한다.
- 기존 동작이 이미 완료 조건을 만족하면 회귀 테스트로 이를 증명하고 문서만 갱신한다.
- application service, project-local `.harness/`, typed transport, CLI-owned provider 인증 원칙은 `local-desktop-architecture.md`를 따른다.

## 티켓 목록

### A01: Application service 경계 추출

Depends on: 없음

Status: 완료

- HTTP route와 CLI에 섞인 project, task, agent, approval mutation을 application service로 이동한다.
- transport가 request/argv를 검증한 뒤 같은 service를 호출하게 한다.
- 서비스 단위 테스트로 HTTP와 CLI의 규칙 일치를 검증한다.

완료 조건: transport가 raw DB mutation을 소유하지 않고 기존 API·CLI 동작이 유지된다.

검증: application service CRUD 회귀 테스트, CLI/HTTP 교차 smoke, `pnpm typecheck`, `pnpm test`, `pnpm build`.

### A02: Project-local layout, lock, migration과 recovery

Depends on: A01

Status: 완료

- `.harness/manifest.json`, config, DB, runtime, reports, runs, worktree/workspace layout을 관리한다.
- SQLite WAL, project writer lock, stale instance와 interrupted run recovery를 구현한다.
- 이동된 project를 다시 열고 동시 writer 및 crash recovery를 테스트한다.

완료 조건: project folder와 `.harness/`만 이동해도 상태를 복구하고 중복 mutation을 차단한다.

검증: layout/manifest migration, WAL pragma, active·stale lock, moved project relink, interrupted run recovery 회귀 테스트와 전체 typecheck/build.

### A03: File-based agent persona와 migration

Depends on: A02

Status: 완료

- `.harness/agent/<slug>--<id>/agent.md` schema, parser, validator와 atomic writer를 구현한다.
- instruction path escape와 secret 저장을 차단하고 기존 DB agent를 idempotent하게 materialize한다.
- definition hash, run snapshot, 외부 수정 충돌과 invalid 상태를 지원한다.

완료 조건: agent Markdown이 기준 원본이며 이동·외부 편집·migration 후에도 실행 맥락이 재현된다.

검증: schema round-trip, unknown field/section 보존, stable folder, external sync, hash conflict, disabled/invalid 실행 차단, path·symlink·secret 거부, template migration과 run snapshot 회귀 테스트.

### A04: Electron shell과 typed IPC

Depends on: A01, A02, A03

Status: 완료

- Electron main, secure preload, packaged React renderer와 versioned IPC invoke/subscribe 계약을 추가한다.
- renderer의 Node·filesystem·child process 직접 접근을 금지한다.
- folder picker와 주요 board service를 typed IPC로 실행한다.

완료 조건: context isolation이 켜진 desktop에서 주요 기능이 IPC만으로 동작한다.

검증: versioned command contract, shared application command integration, secure BrowserWindow/preload contract, packaged relative assets, full workspace build와 Electron launch smoke.

### A05: Optional HTTP transport 분리

Depends on: A04

Status: 완료

- production desktop에서 persistent HTTP server 자동 시작을 제거한다.
- headless/remote 사용 시에만 명시적으로 HTTP transport를 시작한다.
- desktop smoke에서 listening TCP port 없이 board 동작을 검증한다.

완료 조건: desktop 기본 경로는 packaged asset과 IPC로만 동작하고 HTTP는 선택 기능이다.

검증: 모든 renderer service action의 IPC command coverage, dispatcher integration tests, full build와 Electron main process listening-TCP 부재 smoke.

### A06: CLI-owned 인증과 credential 보호

Depends on: A01, A02

Status: 완료

- Codex, Claude, Cursor CLI의 기존 login session을 재사용한다.
- executable/version/login 상태 진단과 공식 login 안내를 제공한다.
- credential이 DB, `.harness/`, prompt, event, report와 telemetry에 저장되지 않게 redaction 테스트를 추가한다.

완료 조건: Harness token 입력 없이 CLI provider를 실행하며 credential 유출 회귀 테스트가 통과한다.

검증: executable/version/login diagnostics, missing-CLI 안내, literal credential settings 거부, provider output/error/event redaction, CLI provider catalog smoke와 전체 build.

### A07: Versioned provider event 계약

Depends on: A01, A02

Status: 완료

- 공통 envelope, event 종류, capability와 민감정보 제거 규칙을 정의한다.
- sequence 중복 제거·순서 보정·replay·terminal idempotency를 구현한다.
- streaming 미지원 provider의 단일 결과 fallback을 유지한다.

완료 조건: event가 append-only로 저장되고 reconnect 후 누락 없이 재생된다.

검증: SQLite append/restart replay, run sequence 정렬, sequence·terminal 중복 제거, payload credential redaction, 비스트리밍 mock fallback, desktop IPC replay/구독 해제 계약, run timeline 표시와 전체 typecheck/test/build.

### A08: Cursor CLI provider

Depends on: A06, A07

Status: 완료

- `cursor-cli` catalog, `cursor-agent` 탐지·인자·모델·timeout·capability를 추가한다.
- stdout/stderr parser를 공통 event로 정규화하고 session resume 가능 여부를 반영한다.
- Harness provider 실행과 Cursor MCP client 연결을 UI·문서에서 구분한다.

완료 조건: Cursor 실행 결과가 다른 provider와 같은 run timeline에 표시된다.

검증: 공식 stream-JSON fixture parser, prompt/file-content 비저장, fake `cursor-agent` executable version/status/login-session 진단, task-level provider override, live common event 순서, default command와 process-group timeout, capability catalog, UI 안내와 전체 typecheck/test/build.

### A09: Draft session과 collaboration data

Depends on: A01, A02, A07

Status: 완료

- draft session, revision, reviewer, comment thread, reply와 apply history를 영속화한다.
- debounce, cancellation, dedupe, rate limit과 stale revision 제외 규칙을 구현한다.
- reconnect event replay와 restart recovery를 테스트한다.

완료 조건: popup/server 재시작 뒤에도 작성 중인 협업 기록과 revision 연결이 보존된다.

검증: project-local schema migration, optimistic revision conflict, unchanged-content/request/comment/reply/apply dedupe, debounce cancellation, reviewer rate limit, stale response exclusion, sequence reconnect replay, running request restart recovery, application command round-trip과 전체 typecheck/test/build.

### A10: Realtime draft review UI와 agents

Depends on: A09

Status: 완료

- 2열 draft/comment UI, small-screen tab/drawer와 streaming 상태를 구현한다.
- 기획 리뷰어와 예외 감지 reviewer 역할, mention, reply, retry와 stop을 제공한다.
- 사용자 입력과 draft 변경만 자동 review trigger가 되게 한다.

완료 조건: 편집을 막지 않고 revision별 제안·질문·위험을 실시간 확인하고 응답할 수 있다.

검증: deterministic planning/edge-case reviewer progress·stop·retry·reply-turn·duplicate suppression 테스트, draft event IPC replay, Strict Mode draft restore, desktop 2열 live review browser smoke, 390×844 Draft/Review tab 전환과 전체 typecheck/test/build.

### A11: Draft apply, diff, approval과 undo

Depends on: A09, A10

Status: 완료

- 선택 comment와 expected revision을 포함한 idempotent apply를 구현한다.
- 구조화된 planning 결과, 원문 diff, 승인·취소·undo·revision restore를 제공한다.
- 미결 질문은 임의로 채우지 않고 별도 상태로 보존한다.

완료 조건: 명시적 승인 전에는 초안이 변하지 않고 승인 후 즉시 되돌릴 수 있다.

검증: 선택 comment·expected revision·idempotency, 구조화 planning 결과와 unified diff, 승인 전 무변경, 승인·취소·undo·revision restore, 미결 질문 이월을 서버 통합 테스트로 검증했다. 브라우저 smoke에서 선택 → diff → 승인 → undo → 과거 revision 복원과 console 오류 없음까지 확인했다.

### A12: Interaction 모델과 suspended run

Depends on: A01, A02, A07

Status: 완료

- question, approval, permission, review와 상태 전이를 영속화한다.
- run의 `suspended` 상태와 provider completed/failed/suspended 결과를 정의한다.
- 기존 approval API·데이터 호환 migration을 제공한다.

완료 조건: 대기 interaction과 suspended run이 restart 후에도 유실되지 않는다.

검증: 네 interaction kind와 pending/resolved/rejected/expired 전이, correlation idempotency, expiry recovery, credential rejection, mock provider의 structured suspended 결과와 checkpoint, restart 보존, legacy/new approval 양방향 link와 상태 trigger를 통합 테스트로 검증했다.

### A13: Interaction 응답과 실행 재개

Depends on: A12

Status: 완료

- checkpoint, provider session 또는 후속 run으로 동일 맥락을 재개한다.
- 중복·만료 응답, 취소 run, 거절과 재시작 recovery를 안전하게 처리한다.
- Attention, card, CLI와 timeline에서 같은 interaction 상태를 표시한다.

완료 조건: 사용자 응답 뒤 기존 task/run/agent correlation을 유지하며 실행이 이어진다.

검증: suspended question 응답의 후속 run, parent/correlation/agent 연계, response·checkpoint 전달, idempotency key 중복 방지, 충돌·만료·거절·서버 재시작 복구와 재개 중단 정리를 서버 통합 테스트로 검증했다. typed application/HTTP/CLI 응답 경로와 desktop IPC payload를 확인했고, 브라우저 smoke에서 Attention·카드·상세 interaction 상태, 일반 Resume 우회 차단, 응답 후 timeline·후속 run 표시와 console 오류 없음을 확인했다.

### A14: Completion report와 post-run diff review

Depends on: A02, A07, A12

Status: 완료

- 변경량·검증·고위험 지표와 먼저 검토할 파일 추천을 저장한다.
- 고정 template의 sanitized HTML report와 plain-text fallback을 구현한다.
- snapshot 기반 side diff, review 상태와 terminal run 전용 inline comment를 제공한다.

완료 조건: 완료 카드에서 재현 가능한 report, 우선 파일, diff와 후속 수정 연결을 확인한다.

검증: 실제 Git snapshot/commit fixture에서 추가·삭제·rename·binary·고위험 분류와 정량 지표, structured/fallback report revision, CSP/HTML escape, 최대 3개 추천과 검토 상태, snapshot 고정 diff, terminal-only inline comment와 review follow-up/addressed lineage, review backlog scheduler gate를 서버 통합 테스트로 검증했다. 브라우저 smoke에서 sandbox report, unified/split diff, whitespace 무시·wrap, inline comment, 검토 완료, follow-up 생성, health/Attention/merge 추천과 오류 없는 렌더링을 확인했다.

### A15: Multi-layer workspace protection

Depends on: A07, A12

Status: 완료

- provider cwd를 worktree에 고정하고 canonical path 기준 workspace escape를 판정한다.
- warn/pause/block interaction, streaming 미지원 snapshot 비교와 audit을 구현한다.
- worktree pre-push hook 설치·변조 감지와 run 단위 일회성 예외를 제공한다.

완료 조건: worktree 밖 쓰기와 직접 push가 기본 정책에서 중단되고 승인 범위가 기록된다.

검증: Edit/Write/MultiEdit/NotebookEdit와 shell event의 상대·절대·`..`·symlink·Windows/Unix path 판정, credential redaction, non-streaming checkout snapshot 비교를 단위·통합 테스트로 검증했다. 실제 Git pre-push가 기본 차단되고 run token에서만 통과하는지, hook 변조가 pause interaction을 만들고 승인 후 복구되는지, Cursor violation이 pause→동일 fingerprint 1회 재개되는지, warn과 block 모드 및 audit timeline을 확인했다.

### A16: Harness MCP server와 local bridge

Depends on: A01, A02, A12, A15

Status: 완료

- stdio MCP entry point, versioned schemas와 read/write scope를 구현한다.
- active desktop에는 local socket/named pipe, offline에는 writer lock service fallback을 사용한다.
- 초기 board/task/run/interaction/approval tools와 dry-run·audit을 제공한다.

완료 조건: Cursor 등 MCP client가 기존 policy를 우회하지 않고 board를 조회·변경한다.

검증: versioned input/output schema와 15개 tool을 stdio로 조회하고, 미등록·read-only·project 제한 client의 거부, dry-run 무변경, 허용된 task 생성·comment·interaction 응답을 통합 테스트했다. active desktop bridge와 offline writer-lock fallback, global/project audit, bridge 종료 정리, Settings scope 변경 및 Electron 무포트 smoke를 확인했다.

### A17: OpenTelemetry tracing

Depends on: A07, A12, A14, A16

Status: 완료

- plan부터 merge/recovery까지 span naming, correlation attribute와 event를 계측한다.
- 기본 비활성, 선택적 OTLP exporter, timeout과 non-blocking failure를 구현한다.
- content·credential 비수집과 SQLite audit trace 연결을 테스트한다.

완료 조건: 전체 실행 계보를 추적할 수 있고 telemetry off 환경에는 별도 인프라가 필요 없다.

검증: in-memory OpenTelemetry exporter로 parent/child trace 계보, schema v1 span 이름, prompt·오류 내용 비수집, SQLite audit의 trace/span ID 연결을 검증했다. 기본 비활성 상태와 OTLP HTTP batch exporter의 bounded queue·timeout·실패 비전파를 확인하고 선택형 Jaeger compose와 실행 명령을 문서화했다.

### A18: Scenario-first README와 verified setup

Depends on: A04, A08, A11, A13, A14, A16, A17

Status: 완료

- 실제 협업 시나리오를 먼저 보여주고 현재 지원·미지원 범위를 분리한다.
- desktop, 선택적 HTTP, provider login, MCP와 OS별 troubleshooting을 검증된 명령으로 작성한다.
- quick start smoke 절차를 자동화한다.

완료 조건: 새 사용자가 문서만으로 첫 project·agent·task·approval 흐름을 재현한다.

검증: 임시 HARNESS_HOME에서 project 등록, Git baseline, shell agent/task 생성, command approval 생성·승인과 completed run까지 `pnpm smoke:quick-start`로 재현했다. Node/pnpm/Git 기준, desktop/headless 분리, OS folder picker, 공식 provider 설치·login 진단, Cursor desktop/Agent/MCP 구분, port·PATH·Git·MCP troubleshooting과 전체 CLI reference를 현재 command와 대조했다.

### A19: Agent Dog Overlay

Depends on: A04, A07, A12

Status: 완료

- 독자적 sprite, activity engine, privacy filter와 read-only tooltip/toast를 구현한다.
- macOS click-through adapter와 Windows compile-time stub/contract test를 제공한다.
- reduced motion, privacy mode, disable 설정과 overlay failure isolation을 지원한다.

완료 조건: macOS에서 최대 5개 agent 상태를 안전하게 표시하고 공통 code 재작성 없이 Windows adapter를 추가할 수 있다.

검증: activity EMA/stage·waiting/completed override, stable 5종 dog assignment, reduced motion, toast dedupe, privacy allowlist와 asset manifest/provenance를 단위 테스트했다. macOS transparent/focusless/always-on-top/click-through window와 display/Spaces/full-screen 설정을 compile·Electron smoke로 확인하고, 동일 interface의 Windows stub contract 및 overlay 실패 비전파를 검증했다.

### A20: Shared transport dispatcher와 CLI desktop bridge

Depends on: A01, A04, A05, A16

Status: 완료

- HTTP, IPC, CLI와 MCP mutation을 versioned application command dispatcher로 통합한다.
- active desktop에서는 CLI가 MCP와 같은 Unix socket 또는 Windows named pipe bridge를 사용한다.
- offline CLI fallback은 project writer lock과 동일 validation·approval·audit을 적용한다.

완료 조건: 같은 명령이 transport에 관계없이 같은 결과와 오류를 만들고 active desktop과 offline fallback에서 중복 mutation이 없다.

검증: HTTP route, typed IPC, CLI와 MCP가 versioned application command dispatcher를 공유하도록 통합했다. 실제 HTTP server 요청, active desktop bridge를 강제한 CLI 요청, offline CLI fallback에서 동일 task mutation과 validation 오류를 확인하고 중복 저장이 없음을 검증했다. 전체 workspace typecheck·build와 server 30개·desktop 2개 테스트를 통과했다.

### A21: Provider event retention과 safe compaction

Depends on: A07, A20

Status: 완료

- project별 event 최대량과 보존 기간 설정을 추가한다.
- 긴 tool output은 credential redaction 후 bounded summary로 저장한다.
- terminal event와 audit 연결을 보존하면서 원본 event를 안전하게 정리한다.

완료 조건: 대량 event가 설정 한도를 넘지 않고 replay·terminal idempotency·민감정보 보호가 유지된다.

검증: project별 최대 event 수, 보존 일수와 tool output 요약 길이를 settings, CLI와 Web UI에 추가했다. append 및 설정 변경 시 만료·초과 일반 event를 자동 삭제하고 terminal marker와 correlation을 보존하며, 긴 tool result는 credential redaction 후 bounded summary·hash·크기 metadata로 저장한다. 대량 event·기간 만료·terminal 중복·민감정보 회귀 테스트, 전체 workspace typecheck·build, server 31개·desktop 2개 테스트를 통과했다. `pnpm dev` 브라우저 테스트에서 세 설정의 표시·저장·새로고침 복원을 확인했다.

### A22: Direct provider OAuth와 OS keychain 경계

Depends on: A06, A20

Status: 완료

- CLI로 제공할 수 없는 직접 provider만 OAuth 2.1 PKCE/device flow를 선언할 수 있는 adapter contract를 만든다.
- credential storage를 macOS Keychain, Windows Credential Manager와 Linux Secret Service adapter 뒤로 격리한다.
- project에는 비민감 account reference만 저장하고 지원 provider가 없을 때 UI/API가 기능을 노출하지 않게 한다.

완료 조건: 직접 인증 기능이 opt-in capability로만 존재하고 token이 project·DB·event·trace에 저장되지 않는다.

검증: RFC 7636 `S256` PKCE와 RFC 8628 device authorization public-client 정의를 opt-in contract로 추가하고 client secret, 비-HTTPS endpoint와 미등록 redirect를 거부한다. macOS Keychain, Windows Credential Manager/Credential Locker와 Linux Secret Service를 공통 adapter 뒤로 격리하고 secret은 command stdin 또는 OS store에서만 다룬다. global/project DB에는 비민감 account reference만 저장하며, 기본 provider catalog에는 direct provider가 없어 로그인 UI/API capability가 노출되지 않는다. PKCE/device, OS별 adapter, rollback·disconnect, raw DB/`.harness/` token 비저장 테스트와 전체 workspace typecheck·build, server 34개·desktop 2개 테스트를 통과했다.

### A23: Agent Markdown application service와 derived index

Depends on: A03, A20

Status: 완료

- agent Markdown CRUD, instruction file 관리, clone, archive와 folder-open 정보를 공통 service로 통합한다.
- DB의 편집 원본 중복을 제거하고 runtime·parse·hash·통계 파생 index만 유지한다.
- active assignment/run archive 차단과 expected hash validation을 제공한다.

완료 조건: desktop, web, CLI와 MCP가 같은 atomic writer와 validation으로 agent 원본을 변경한다.

검증: structured patch와 raw Markdown save, invalid source 복구, instruction 생성·수정·이름·순서·제거, clone, archive와 folder 정보를 공통 application service에 통합했다. DB의 agent 내용 필드는 `agent.md`에서만 sync되는 runtime/planner 파생 cache로 제한하고 archive index를 추가했다. definition/instruction expected hash 충돌, symlink·secret validation, active run 및 assigned task archive 차단, replacement reassignment, archive 원본 보존과 clone instruction 복제를 통합 테스트했다. typed IPC/HTTP/CLI/MCP가 같은 command dispatcher를 사용하며 실제 CLI update와 MCP update/dry-run을 확인했다. 전체 workspace typecheck·build와 server 35개·desktop 2개 테스트를 통과했다.

### A24: Agent Markdown editor, diff와 validation UI

Depends on: A23

- 구조화 form과 raw Markdown editor가 하나의 in-memory document를 편집한다.
- 변경 결과에서 원본 대비 diff와 validation 결과를 표시하고 오류가 있을 때만 저장을 막는다.
- preview, instruction ordering, clone, disable, archive와 folder-open UI를 제공한다.

완료 조건: 사용자가 앱과 웹에서 agent Markdown을 손실 없이 편집하고 결과·검증을 확인할 수 있다.

### A25: External agent edit watcher와 conflict resolution

Depends on: A23, A24

- agent Markdown/instruction 변경을 debounce하는 file watcher와 version event를 구현한다.
- 편집 중 content hash가 바뀌면 overwrite, reload와 manual merge 선택을 제공한다.
- watcher restart, atomic rename과 multi-process writer lock 회귀를 검증한다.

완료 조건: 외부 편집이 다음 run과 UI에 반영되고 동시 편집이 사용자 선택 없이 덮어쓰지 않는다.

## 실행 순서

기본 순서는 A01부터 A25까지다. 의존성이 충족된 티켓만 시작하며, 각 티켓의 검증과 커밋이 끝난 후 다음 티켓으로 진행한다. `todo.md`의 선택적 Worktree Preview는 자동 진행 대상이 아니다.
