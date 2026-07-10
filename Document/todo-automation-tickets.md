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

- 2열 draft/comment UI, small-screen tab/drawer와 streaming 상태를 구현한다.
- 기획 리뷰어와 예외 감지 reviewer 역할, mention, reply, retry와 stop을 제공한다.
- 사용자 입력과 draft 변경만 자동 review trigger가 되게 한다.

완료 조건: 편집을 막지 않고 revision별 제안·질문·위험을 실시간 확인하고 응답할 수 있다.

### A11: Draft apply, diff, approval과 undo

Depends on: A09, A10

- 선택 comment와 expected revision을 포함한 idempotent apply를 구현한다.
- 구조화된 planning 결과, 원문 diff, 승인·취소·undo·revision restore를 제공한다.
- 미결 질문은 임의로 채우지 않고 별도 상태로 보존한다.

완료 조건: 명시적 승인 전에는 초안이 변하지 않고 승인 후 즉시 되돌릴 수 있다.

### A12: Interaction 모델과 suspended run

Depends on: A01, A02, A07

- question, approval, permission, review와 상태 전이를 영속화한다.
- run의 `suspended` 상태와 provider completed/failed/suspended 결과를 정의한다.
- 기존 approval API·데이터 호환 migration을 제공한다.

완료 조건: 대기 interaction과 suspended run이 restart 후에도 유실되지 않는다.

### A13: Interaction 응답과 실행 재개

Depends on: A12

- checkpoint, provider session 또는 후속 run으로 동일 맥락을 재개한다.
- 중복·만료 응답, 취소 run, 거절과 재시작 recovery를 안전하게 처리한다.
- Attention, card, CLI와 timeline에서 같은 interaction 상태를 표시한다.

완료 조건: 사용자 응답 뒤 기존 task/run/agent correlation을 유지하며 실행이 이어진다.

### A14: Completion report와 post-run diff review

Depends on: A02, A07, A12

- 변경량·검증·고위험 지표와 먼저 검토할 파일 추천을 저장한다.
- 고정 template의 sanitized HTML report와 plain-text fallback을 구현한다.
- snapshot 기반 side diff, review 상태와 terminal run 전용 inline comment를 제공한다.

완료 조건: 완료 카드에서 재현 가능한 report, 우선 파일, diff와 후속 수정 연결을 확인한다.

### A15: Multi-layer workspace protection

Depends on: A07, A12

- provider cwd를 worktree에 고정하고 canonical path 기준 workspace escape를 판정한다.
- warn/pause/block interaction, streaming 미지원 snapshot 비교와 audit을 구현한다.
- worktree pre-push hook 설치·변조 감지와 run 단위 일회성 예외를 제공한다.

완료 조건: worktree 밖 쓰기와 직접 push가 기본 정책에서 중단되고 승인 범위가 기록된다.

### A16: Harness MCP server와 local bridge

Depends on: A01, A02, A12, A15

- stdio MCP entry point, versioned schemas와 read/write scope를 구현한다.
- active desktop에는 local socket/named pipe, offline에는 writer lock service fallback을 사용한다.
- 초기 board/task/run/interaction/approval tools와 dry-run·audit을 제공한다.

완료 조건: Cursor 등 MCP client가 기존 policy를 우회하지 않고 board를 조회·변경한다.

### A17: OpenTelemetry tracing

Depends on: A07, A12, A14, A16

- plan부터 merge/recovery까지 span naming, correlation attribute와 event를 계측한다.
- 기본 비활성, 선택적 OTLP exporter, timeout과 non-blocking failure를 구현한다.
- content·credential 비수집과 SQLite audit trace 연결을 테스트한다.

완료 조건: 전체 실행 계보를 추적할 수 있고 telemetry off 환경에는 별도 인프라가 필요 없다.

### A18: Scenario-first README와 verified setup

Depends on: A04, A08, A11, A13, A14, A16, A17

- 실제 협업 시나리오를 먼저 보여주고 현재 지원·미지원 범위를 분리한다.
- desktop, 선택적 HTTP, provider login, MCP와 OS별 troubleshooting을 검증된 명령으로 작성한다.
- quick start smoke 절차를 자동화한다.

완료 조건: 새 사용자가 문서만으로 첫 project·agent·task·approval 흐름을 재현한다.

### A19: Agent Dog Overlay

Depends on: A04, A07, A12

- 독자적 sprite, activity engine, privacy filter와 read-only tooltip/toast를 구현한다.
- macOS click-through adapter와 Windows compile-time stub/contract test를 제공한다.
- reduced motion, privacy mode, disable 설정과 overlay failure isolation을 지원한다.

완료 조건: macOS에서 최대 5개 agent 상태를 안전하게 표시하고 공통 code 재작성 없이 Windows adapter를 추가할 수 있다.

## 실행 순서

기본 순서는 A01부터 A19까지다. 의존성이 충족된 티켓만 시작하며, 각 티켓의 검증과 커밋이 끝난 후 다음 티켓으로 진행한다.
