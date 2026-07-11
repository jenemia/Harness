# Harness TODO

이 문서는 아직 완료되지 않은 작업만 관리한다. 완료된 A01–A28 구현과 티켓별 검증·커밋 이력은 [Harness TODO Automation Tickets](Document/todo-automation-tickets.md)에서 확인한다.

구조 변경 작업은 [Harness Local Desktop Architecture](Document/local-desktop-architecture.md)를 먼저 확인하고 application service 경계, project-local `.harness/`, typed transport와 CLI-owned 인증 원칙을 따른다.

현재 남아 있는 자동 진행 대상은 없다. Electron desktop은 제품의 기본 실행 경로이며, 웹 UI 개발·브라우저 테스트가 필요할 때만 `pnpm dev`로 API와 Vite 개발 서버를 명시적으로 실행한다.
