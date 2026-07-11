# Harness TODO

이 문서는 아직 완료되지 않은 작업만 관리한다. 완료된 A01–A25 구현과 티켓별 검증·커밋 이력은 [Harness TODO Automation Tickets](Document/todo-automation-tickets.md)에서 확인한다.

구조 변경 작업은 [Harness Local Desktop Architecture](Document/local-desktop-architecture.md)를 먼저 확인하고 application service 경계, project-local `.harness/`, typed transport와 CLI-owned 인증 원칙을 따른다.

## 선택적 Worktree 산출물 Preview

Electron desktop이 제품의 기본 실행 경로이므로 Harness는 project별 개발 서버를 기본으로 시작하거나 worktree별 port를 자동 배정하지 않는다. 단, 웹 UI 개발·브라우저 테스트에서는 `pnpm dev`로 API와 Vite 개발 서버를 명시적으로 실행한다.

- [ ] preview 실행의 URL·산출물 경로·PID·log와 `booting`, `live`, `crashed`, `stopped` 상태를 저장한다.
- [ ] 카드에서 preview 상태 확인, 중지·재시작과 산출물 또는 외부 URL 열기를 제공한다.
- [ ] 앱 재시작 시 Harness가 소유한 선택적 preview process만 탐지하고 정리한다.
