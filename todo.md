# Harness TODO

이 문서는 아직 완료되지 않은 작업만 관리한다. 완료된 A01–A19 구현과 티켓별 검증·커밋 이력은 [Harness TODO Automation Tickets](Document/todo-automation-tickets.md)에서 확인한다.

구조 변경 작업은 [Harness Local Desktop Architecture](Document/local-desktop-architecture.md)를 먼저 확인하고 application service 경계, project-local `.harness/`, typed transport와 CLI-owned 인증 원칙을 따른다.

## Application service와 인증 경계

### Transport 통합

- [ ] HTTP route, IPC, CLI와 MCP에 남아 있는 transport별 business logic을 모두 같은 application service로 이동한다.
- [ ] desktop 실행 중 CLI도 MCP와 동일하게 Unix domain socket 또는 Windows named pipe application bridge를 사용하게 한다.

### 직접 provider 인증 예외

- [ ] CLI로 제공할 수 없어 provider API 직접 접근이 필요한 기능만 OAuth 2.1 PKCE 또는 device authorization으로 설계한다.
- [ ] OAuth credential은 OS keychain에 저장하고 `.harness/`에는 account reference와 비민감 metadata만 기록한다.

## Provider event 보존 정책

- [ ] provider event 저장량 제한을 설정할 수 있게 한다.
- [ ] 긴 tool output의 안전한 요약 정책을 구현한다.
- [ ] project별 보존 기간과 원본 event 삭제 정책을 제공한다.

## `.harness/agent` 관리 완성

기준 원본은 project별 `.harness/agent/<agent-slug>--<short-id>/agent.md`와 명시적으로 연결된 instruction Markdown이다.

### 파생 index 정리

- [ ] DB에는 agent id, 파일 경로, content hash, parse 상태, runtime 상태, current task와 실행 통계만 파생 index로 남긴다.

### App 및 Web 관리 UI

- [ ] `에이전트 관리`에서 project agent 목록과 파일 parse 상태를 보여준다.
- [ ] agent 생성 시 folder와 기본 `agent.md`를 만들고 template 또는 빈 정의로 시작할 수 있게 한다.
- [ ] 구조화 form과 raw Markdown editor가 같은 in-memory document를 편집하게 한다.
- [ ] 저장 전 diff와 validation 결과를 보여준다.
- [ ] persona와 instruction Markdown preview를 제공한다.
- [ ] instruction file 생성, 이름 변경, 순서 변경, 편집과 제거를 지원한다.
- [ ] agent 복제, 비활성화, archive와 folder 열기를 제공한다.
- [ ] archive 시 `.harness/agent/.archive/<agent-folder>/`에 원본 Markdown을 보존한다.
- [ ] active run 또는 assigned task가 있는 agent의 archive·삭제를 차단하고 reassignment 흐름을 제공한다.
- [ ] desktop typed IPC와 선택적 web transport가 동일 agent application service를 사용하게 한다.

### 외부 편집과 충돌 처리

- [ ] file watcher가 외부 editor의 `agent.md`와 instruction 변경을 debounce해 감지한다.
- [ ] UI 편집 중 외부 파일이 바뀌면 content hash 충돌을 감지하고 overwrite, reload 또는 수동 merge를 선택하게 한다.
- [ ] app, web, CLI와 MCP의 agent 저장이 같은 validation과 atomic writer를 사용하게 한다.

## 진행하면 좋은 것들 (자동 진행 대상 아님)

### Worktree별 개발 서버 Preview

- [ ] project별 기본 dev server command와 readiness check를 정의한다.
- [ ] worktree마다 충돌하지 않는 port와 환경변수를 할당한다.
- [ ] preview URL, PID, log와 `booting`, `live`, `crashed`, `stopped` 상태를 저장한다.
- [ ] 카드에서 preview 시작·중지·재시작과 외부 브라우저 열기를 제공한다.
- [ ] 서버 재시작 시 남은 preview process를 탐지하고 정리한다.
- [ ] 여러 service를 가진 monorepo와 Docker 기반 개발 환경의 preview 전략을 별도로 설계한다.
- [ ] preview command는 사용자 승인 및 project policy를 통과하고 secret을 UI와 log에 노출하지 않는다.

## 남은 작업 완료 기준

- transport가 달라도 같은 validation, writer lock, approval, scheduler와 audit 규칙을 적용한다.
- provider event 보존량을 제어하면서 credential과 민감한 원문을 노출하지 않는다.
- agent Markdown이 유일한 편집 원본이고 외부 편집 충돌을 UI에서 안전하게 해결할 수 있다.
- Worktree Preview는 별도 승인 전까지 자동 진행 범위에 포함하지 않는다.
