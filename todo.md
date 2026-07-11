# Harness TODO

이 문서는 아직 완료되지 않은 작업만 관리한다. 완료된 A01–A25 구현과 티켓별 검증·커밋 이력은 [Harness TODO Automation Tickets](Document/todo-automation-tickets.md)에서 확인한다.

구조 변경 작업은 [Harness Local Desktop Architecture](Document/local-desktop-architecture.md)를 먼저 확인하고 application service 경계, project-local `.harness/`, typed transport와 CLI-owned 인증 원칙을 따른다.

## 진행하면 좋은 것들 (자동 진행 대상 아님)

### 선택적 Worktree 산출물 Preview

Electron desktop이 제품의 기본 실행 경로이므로 Harness는 project별 개발 서버를 기본으로 시작하거나 worktree별 port를 자동 배정하지 않는다. 단, 웹 UI 개발·브라우저 테스트에서는 `pnpm dev`로 API와 Vite 개발 서버를 명시적으로 실행한다.

- [ ] 사용자가 명시적으로 등록한 preview command 또는 생성된 산출물 경로만 카드에 연결한다.
- [ ] preview 실행의 URL·산출물 경로·PID·log와 `booting`, `live`, `crashed`, `stopped` 상태를 저장한다.
- [ ] 카드에서 preview 상태 확인, 중지·재시작과 산출물 또는 외부 URL 열기를 제공한다.
- [ ] 앱 재시작 시 Harness가 소유한 선택적 preview process만 탐지하고 정리한다.
- [ ] monorepo와 Docker 기반 개발 환경의 preview command 계약을 별도로 설계한다.
- [ ] preview command는 사용자 승인 및 project policy를 통과하고 secret을 UI와 log에 노출하지 않는다.

선택적 Worktree Preview는 별도 승인 전까지 자동 진행 범위에 포함하지 않는다.
