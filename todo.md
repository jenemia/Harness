# Harness TODO

이 문서는 아직 완료되지 않은 작업만 관리한다. 완료된 A01–A22 구현과 티켓별 검증·커밋 이력은 [Harness TODO Automation Tickets](Document/todo-automation-tickets.md)에서 확인한다.

구조 변경 작업은 [Harness Local Desktop Architecture](Document/local-desktop-architecture.md)를 먼저 확인하고 application service 경계, project-local `.harness/`, typed transport와 CLI-owned 인증 원칙을 따른다.

## `.harness/agent` 관리 완성

기준 원본은 project별 `.harness/agent/<agent-slug>--<short-id>/agent.md`와 명시적으로 연결된 instruction Markdown이다.

### 파생 index 정리

- [ ] DB에는 agent id, 파일 경로, content hash, parse 상태, runtime 상태, current task와 실행 통계만 파생 index로 남긴다.

### App 및 Web 관리 UI

- [ ] `에이전트 관리`에서 project agent 목록과 파일 parse 상태를 보여준다.
- [ ] agent 생성 시 folder와 기본 `agent.md`를 만들고 template 또는 빈 정의로 시작할 수 있게 한다.
- [ ] 구조화 form과 raw Markdown editor가 같은 in-memory document를 편집하게 한다.
- [ ] 변경 결과에서 원본 대비 diff와 validation 결과를 보여준다.
- [ ] validation 오류가 있는 경우에만 저장을 차단하고 수정 위치를 안내한다.
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

### 선택적 Worktree 산출물 Preview

Electron desktop이 제품의 기본 실행 경로이므로 Harness는 project별 개발 서버를 기본으로 시작하거나 worktree별 port를 자동 배정하지 않는다. 단, 웹 UI 개발·브라우저 테스트에서는 `pnpm dev`로 API와 Vite 개발 서버를 명시적으로 실행한다.

- [ ] 사용자가 명시적으로 등록한 preview command 또는 생성된 산출물 경로만 카드에 연결한다.
- [ ] preview 실행의 URL·산출물 경로·PID·log와 `booting`, `live`, `crashed`, `stopped` 상태를 저장한다.
- [ ] 카드에서 preview 상태 확인, 중지·재시작과 산출물 또는 외부 URL 열기를 제공한다.
- [ ] 앱 재시작 시 Harness가 소유한 선택적 preview process만 탐지하고 정리한다.
- [ ] monorepo와 Docker 기반 개발 환경의 preview command 계약을 별도로 설계한다.
- [ ] preview command는 사용자 승인 및 project policy를 통과하고 secret을 UI와 log에 노출하지 않는다.

## 남은 작업 완료 기준

- agent Markdown이 유일한 편집 원본이고 외부 편집 충돌을 UI에서 안전하게 해결할 수 있다.
- 선택적 Worktree Preview는 별도 승인 전까지 자동 진행 범위에 포함하지 않는다.
