# Harness TODO

## 목표

Harness의 업무 카드 작성과 실행 흐름을 단순 입력·실행 구조에서 사람과 여러 에이전트가 같은 맥락 안에서 협업하는 구조로 확장한다.

핵심 목표는 다음과 같다.

- 업무 카드 작성 단계에서 에이전트가 초안을 실시간으로 검토하고 사용자와 대화한다.
- Cursor CLI를 실행 provider로 지원하고 Cursor가 MCP를 통해 Harness 보드를 다룰 수 있게 한다.
- provider 출력을 구조화된 실시간 이벤트로 통합해 진행 상황, 도구 사용, 질문, 사용량과 변경 내역을 즉시 추적한다.
- 에이전트 실행 중 발생한 질문, 승인, 권한 요청을 작업 맥락과 함께 보존하고 응답 후 실행을 재개한다.
- 작업 완료 결과를 검토 가능한 크기와 순서로 제시하고 카드 안에서 완료 보고서와 파일별 diff를 확인하게 한다.
- 계획, 실행, 대기, 재개, handoff, 병합 흐름을 OpenTelemetry로 추적한다.
- README를 기능 목록보다 실제 협업 시나리오가 먼저 보이도록 개편한다.

## 1. 업무 카드 작성 팝업의 실시간 에이전트 협업

### 사용자 시나리오

1. 사용자가 업무 카드 팝업을 열고 작업 내용 초안을 작성한다.
2. `기획 리뷰어 에이전트`와 `예외 상황 감지 에이전트`가 변경되는 초안을 실시간으로 읽는다.
3. 두 에이전트는 팝업 오른쪽의 코멘트 리스트에 검토 의견과 질문을 표시한다.
4. 사용자는 같은 코멘트 영역에서 에이전트에게 답변하거나 추가 지시를 입력한다.
5. 사용자가 코멘트의 `내용 반영` 버튼을 누르면 `기획 에이전트`가 현재 초안과 전체 코멘트를 종합한다.
6. 기획 에이전트는 정리된 작업 내용과 변경 요약을 제안한다.
7. 사용자가 제안을 승인하면 카드 초안에 반영한다. 사용자는 반영 전 내용으로 되돌릴 수 있다.

### 에이전트 역할

#### 기획 리뷰어 에이전트

- 목표와 요구사항이 명확한지 검토한다.
- 작업 범위, 완료 조건, 의존성, 담당 역할이 빠져 있는지 확인한다.
- 구현 방법을 임의로 확정하지 않고 필요한 질문을 코멘트로 남긴다.
- 같은 내용의 코멘트를 반복하지 않고 해결된 코멘트는 다시 제안하지 않는다.

#### 예외 상황 감지 에이전트

- 모호한 입력, 상충하는 요구사항, 누락된 실패 처리와 경계 조건을 찾는다.
- 데이터 손실, 보안, 권한, 외부 시스템 의존성, 위험 명령 가능성을 표시한다.
- 작업 실행 전에 인간의 결정이나 승인이 필요한 항목을 구분한다.
- 위험도와 판단 근거를 함께 제시한다.

#### 기획 에이전트

- 사용자의 현재 초안, 두 검토 에이전트의 코멘트, 사용자 답변을 모두 입력으로 받는다.
- 합의된 의견만 작업 내용에 반영한다.
- 해결되지 않은 질문을 임의로 채우지 않고 별도 미결 항목으로 남긴다.
- 정리된 설명, 완료 조건, 의존성, 위험 요소와 변경 요약을 반환한다.

### UI TODO

- [ ] 업무 카드 작성 팝업을 `초안 편집 영역`과 `실시간 코멘트 영역`의 2열 레이아웃으로 구성한다.
- [ ] 작은 화면에서는 코멘트 영역을 탭 또는 drawer로 전환한다.
- [ ] 초안 수정 시 revision을 증가시키고 debounce 후 검토 요청을 전송한다.
- [ ] 코멘트에 작성 에이전트, 대상 draft revision, 생성 시각, 상태를 표시한다.
- [ ] 코멘트 상태로 `검토 중`, `제안`, `질문`, `위험`, `해결됨`, `반영됨`을 지원한다.
- [ ] 사용자가 코멘트 스레드에서 답변하고 에이전트를 직접 언급할 수 있게 한다.
- [ ] 에이전트가 응답 중일 때 스트리밍 상태와 중지·재시도 동작을 제공한다.
- [ ] `내용 반영` 버튼은 반영할 코멘트를 선택할 수 있게 하고 기획 에이전트를 호출한다.
- [ ] 기획 에이전트의 결과를 원문과 diff로 비교한 뒤 승인하도록 한다.
- [ ] 승인 전에는 에이전트가 사용자 초안을 직접 변경하지 못하게 한다.
- [ ] 반영 직후 실행 취소와 이전 revision 복원을 지원한다.
- [ ] 팝업을 닫았다 다시 열어도 초안과 코멘트가 복구되게 한다.

### 서버 및 데이터 TODO

- [ ] 저장되지 않은 카드 초안을 나타내는 draft 세션 모델을 추가한다.
- [ ] draft revision, 참여 에이전트, 코멘트, 사용자 답변과 반영 이력을 영속화한다.
- [ ] 오래된 revision을 검토한 에이전트 응답은 표시하되 자동 반영 대상에서 제외한다.
- [ ] 검토 요청의 debounce, 취소, 중복 제거와 에이전트별 rate limit을 구현한다.
- [ ] 실시간 응답 전송 방식을 정하고 연결 재수립 시 누락 이벤트를 복구한다.
- [ ] 에이전트 간 코멘트가 무한히 서로를 호출하지 않도록 사용자 입력과 초안 변경만 자동 검토 trigger로 삼는다.
- [ ] `내용 반영` 요청에 draft revision과 선택한 comment id를 포함해 중복 실행을 방지한다.
- [ ] 기획 에이전트 결과에 정리된 본문, 완료 조건, 의존성, 위험, 미결 질문, 변경 요약을 구조화해 반환한다.

### 완료 조건

- 사용자가 입력을 이어가는 동안 편집을 막지 않고 두 검토 에이전트의 의견을 받을 수 있다.
- 모든 코멘트가 검토한 draft revision과 연결된다.
- 에이전트 의견은 사용자의 명시적 승인 없이는 초안을 변경하지 않는다.
- `내용 반영` 결과와 원문 차이를 확인하고 승인, 취소, 되돌리기 할 수 있다.
- 팝업 또는 서버 재시작 후에도 작성 중인 협업 기록을 복구할 수 있다.

## 2. Cursor 연결과 구조화된 provider 실시간 이벤트

### Cursor 연결 방식

- [ ] provider catalog에 `cursor-cli` 실행 provider를 추가한다.
- [ ] `cursor-agent` 실행 파일 탐지, 로그인 상태 확인, 기본 인자, 모델과 timeout 설정을 지원한다.
- [ ] Cursor CLI의 stdout과 stderr를 공통 provider event로 변환하는 adapter와 parser를 구현한다.
- [ ] Cursor CLI가 지원하는 streaming, session resume, tool event, usage reporting 기능을 capability로 명시한다.
- [ ] 지원하지 않는 capability는 UI와 API에서 비활성화하고 대체 동작을 안내한다.
- [ ] agent별·project별·task별 Cursor provider 선택과 기존 CLI command override를 지원한다.
- [ ] Cursor가 Harness MCP 서버에 연결해 보드를 조회하고 작업을 수행하는 설정 예시를 제공한다.
- [ ] `cursor-cli`는 Harness가 Cursor를 실행하는 provider이고, Cursor MCP 연결은 Cursor가 Harness를 도구로 사용하는 방식임을 UI와 문서에서 구분한다.

### 공통 provider event 계약

- [ ] 모든 streaming provider가 따르는 versioned event envelope을 정의한다.
- [ ] event 공통 필드로 version, sequence, project id, task id, run id, provider id, timestamp와 correlation id를 기록한다.
- [ ] event 종류로 `text_delta`, `tool_use`, `tool_result`, `diff_hunk`, `decision`, `usage`, `rate_limit`, `result`, `error`를 지원한다.
- [ ] provider별 원본 stream 형식을 공통 event로 정규화하고 필요한 경우 원본 event type만 비민감 metadata로 보존한다.
- [ ] sequence 기반 중복 제거, 순서 보정, reconnect replay와 마지막 수신 위치 복구를 구현한다.
- [ ] event payload에서 API key, credential, 전체 prompt와 민감한 파일 내용을 기본적으로 제거한다.
- [ ] provider capability로 `streaming`, `sessionResume`, `toolEvents`, `diffEvents`, `usageEvents`, `structuredDecision`, `gracefulStop`을 선언한다.
- [ ] provider가 structured event를 지원하지 않으면 기존 단일 결과 실행 방식으로 fallback한다.

### 저장 및 UI

- [ ] 실시간 event를 run timeline에 append-only로 영속화하고 서버 재시작 후 replay할 수 있게 한다.
- [ ] 카드 실행 화면에서 agent text, tool 사용, decision, 사용량, rate limit과 결과 상태를 실시간으로 표시한다.
- [ ] event stream 구독 해제와 재연결이 실제 provider 프로세스를 중단하지 않게 한다.
- [ ] event 저장량 제한, 긴 tool output 요약, 보존 기간과 원본 삭제 정책을 설정할 수 있게 한다.
- [ ] terminal event가 중복 도착해도 run 완료 후처리, commit과 handoff가 한 번만 실행되게 한다.

### 완료 조건

- Cursor CLI를 task 실행 provider로 선택하고 결과를 다른 provider와 같은 run UI에서 확인할 수 있다.
- Cursor에서 MCP 설정을 통해 Harness board tool을 호출할 수 있다.
- streaming provider의 실행 중 event가 순서대로 저장·표시되고 재연결 후 누락분이 복구된다.
- streaming 미지원 provider도 기존 실행 경로로 정상 동작한다.

## 3. 실행 중 질문·승인·권한 요청과 재개

### 상호작용 모델

- [ ] 기존 command, handoff, merge 승인보다 상위 개념인 `Interaction` 모델을 정의한다.
- [ ] 상호작용 종류로 `question`, `approval`, `permission`, `review`를 지원한다.
- [ ] 상호작용 상태로 `pending`, `resolved`, `rejected`, `expired`를 지원한다.
- [ ] interaction에 project, task, run, agent, correlation id, 요청 payload, 응답 payload와 만료 시각을 기록한다.
- [ ] 기존 approval 기록을 interaction과 연결하되 이전 API 및 데이터와의 호환성을 유지한다.

### 실행 상태와 재개

- [ ] run 상태에 `suspended`를 추가한다.
- [ ] provider 실행 결과를 `completed`, `failed`, `suspended`로 구조화한다.
- [ ] 에이전트가 질문이나 권한 요청을 생성하면 현재 실행 checkpoint를 저장하고 run을 중단 상태로 전환한다.
- [ ] 사용자가 코멘트 또는 승인 UI로 응답하면 동일 run의 맥락을 복구해 재개한다.
- [ ] 중복 응답, 만료된 요청, 취소된 run과 서버 재시작을 안전하게 처리한다.
- [ ] 대기 중인 interaction을 Attention 패널, 카드, CLI에서 동일하게 조회할 수 있게 한다.
- [ ] 질문 응답, 승인과 거절, 재개 결과를 task timeline에 기록한다.

### 완료 조건

- 실행 중 질문이 발생해도 작업을 실패 처리하지 않고 `suspended`로 보존한다.
- 사용자의 응답 후 기존 task/run/agent 맥락에서 작업이 이어진다.
- pending interaction은 메모리가 아닌 프로젝트 로컬 DB에 저장된다.
- 재시작 복구 과정에서 대기 중인 interaction과 실행 상태가 유실되지 않는다.

## 4. 검토 가능한 완료 결과와 완료 후 diff 리뷰

### 검토 가능성 지표

- [ ] run과 task에 변경 파일 수, 추가·삭제 line 수, binary 파일 수, 새 파일 수, 삭제 파일 수를 기록한다.
- [ ] 테스트·typecheck·lint·build 실행 여부와 성공 결과를 변경량 지표와 함께 표시한다.
- [ ] 설정 파일, 인증·권한, 데이터베이스 migration, public API와 대규모 변경을 고위험 변경으로 분류한다.
- [ ] project별로 권장 최대 파일 수와 diff line 수를 설정하고 초과 시 경고와 분할 제안을 표시한다.
- [ ] review 대기 카드 수와 미검토 변경량을 project health와 Attention 패널의 제품 지표로 추가한다.
- [ ] scheduler가 실행 슬롯뿐 아니라 review backlog와 미검토 변경량을 보고 새 작업 시작을 제한할 수 있게 한다.

### 먼저 검토할 파일

- [ ] 완료된 run에서 `먼저 검토할 파일`을 최대 3개까지 선정한다.
- [ ] 파일 선정 시 보안·권한 위험, entry point 여부, 핵심 로직, 변경 크기, 다른 파일에 미치는 영향과 테스트 포함 여부를 고려한다.
- [ ] 각 추천 파일에 먼저 봐야 하는 이유와 관련 완료 조건을 짧게 표시한다.
- [ ] 사용자가 추천 순서를 변경하거나 검토 완료로 표시할 수 있게 한다.
- [ ] 검토 완료 상태를 run과 task에 영속화하고 merge 승인 화면에서도 동일하게 보여준다.

### 구현 완료 보고서

- [ ] 작업 완료 시 agent가 구현 요약, 완료 조건 충족 여부, 주요 결정, 변경 파일, 검증 결과, 알려진 제한, 후속 작업을 구조화해 반환한다.
- [ ] 구조화된 결과를 서버의 고정 template으로 HTML 완료 보고서로 렌더링한다.
- [ ] HTML 보고서를 task/run과 연결해 저장하고 카드 화면 안에 embedded 형태로 표시한다.
- [ ] agent가 직접 HTML을 반환하는 fallback이 필요하면 script, inline event handler, 외부 resource와 위험 URL을 제거하는 allowlist sanitizer를 적용한다.
- [ ] embedded 보고서는 sandbox와 제한된 Content Security Policy를 적용하고 Harness 상위 화면에 접근하지 못하게 한다.
- [ ] 보고서에 `무엇을 구현했는가`, `어떻게 검증했는가`, `무엇을 먼저 검토해야 하는가`, `남은 위험과 후속 작업`을 고정 section으로 포함한다.
- [ ] 완료 보고서 생성 실패가 task 실행 자체를 실패시키지 않게 하고 plain-text 요약으로 fallback한다.
- [ ] 후속 run이 생기면 보고서 revision을 추가하고 어떤 run이 작성했는지 표시한다.

### 변경 파일 목록과 사이드 diff

- [ ] 완료된 카드에 변경 파일 목록, 파일 상태, 추가·삭제 line 수와 검토 상태를 표시한다.
- [ ] 파일을 클릭하면 카드 화면 오른쪽 side panel에서 해당 파일의 diff를 연다.
- [ ] side panel에서 unified와 split diff, 이전·다음 파일 이동, whitespace 무시와 line wrap을 지원한다.
- [ ] 새 파일, 삭제 파일, rename, binary와 너무 큰 diff의 대체 표시를 정의한다.
- [ ] diff는 snapshot ref와 완료 commit을 기준으로 계산해 이후 main branch 변경에도 같은 결과를 재현할 수 있게 한다.
- [ ] 대용량 diff는 chunk 단위로 읽고 UI가 멈추지 않게 한다.

### 완료 후 inline review comment

- [ ] inline review comment는 run이 `completed`, `failed`, `stopped` 중 하나의 terminal 상태가 된 후에만 작성할 수 있다.
- [ ] 실시간 `diff_hunk` event는 실행 중 저장할 수 있지만 실행 중 diff 코멘트 입력과 agent 방향 전환 기능은 제공하지 않는다.
- [ ] 코멘트를 run id, file path, line, diff side, snapshot과 연결해 영속화한다.
- [ ] 코멘트 상태로 `open`, `addressed`, `dismissed`를 지원한다.
- [ ] 여러 inline comment를 선택해 작업 완료 후 `수정 요청 반영` 후속 run 또는 reviewer handoff로 전달한다.
- [ ] 후속 run 결과에서 어떤 review comment가 반영됐는지 추적한다.
- [ ] 실행 도중 코멘트 기능은 이 TODO의 범위에서 명시적으로 제외한다.

### 완료 조건

- 완료된 카드에서 구현 완료 HTML 보고서와 변경량 지표를 바로 확인할 수 있다.
- `먼저 검토할 파일` 추천과 이유가 표시된다.
- 변경 파일 클릭 시 카드 side panel에서 재현 가능한 diff가 열린다.
- inline review comment는 실행 완료 후에만 작성되고 후속 수정 작업과 연결된다.

## 5. 다층 작업공간 보호

- [ ] 기존 위험 명령 policy와 command approval을 첫 번째 보호층으로 유지한다.
- [ ] 모든 코드 작업 provider의 cwd를 task worktree로 고정하고 허용된 workspace path를 명시적으로 전달한다.
- [ ] `tool_use` event의 Edit, Write, MultiEdit, NotebookEdit와 shell command에서 worktree 밖 path 접근을 탐지한다.
- [ ] 상대 경로, 절대 경로, `..`, symlink와 platform별 path를 canonical path 기준으로 검사한다.
- [ ] worktree 밖 접근이 감지되면 설정에 따라 `warn`, `pause`, `block` 중 하나를 적용하고 interaction을 생성한다.
- [ ] streaming tool event를 지원하지 않는 provider에는 실행 전 cwd 제한과 실행 후 project snapshot 비교를 적용한다.
- [ ] 각 worktree에 agent의 직접 `git push`를 차단하는 pre-push hook을 설치한다.
- [ ] provider 실행 전 hook 존재와 내용을 확인하고 삭제·변조가 발견되면 audit event와 승인 요청을 생성한다.
- [ ] push, merge, package 설치, project 밖 쓰기는 항상 Harness의 명시적 사용자 동작 또는 승인 경로를 통과하게 한다.
- [ ] 보호 정책 판정, 예외 승인과 실제 실행 결과를 task timeline과 run audit에 기록한다.
- [ ] 오탐으로 인한 1회 허용은 해당 interaction과 run에만 적용하고 project 전역 정책을 자동 변경하지 않는다.

### 완료 조건

- agent가 worktree 밖 파일을 수정하거나 직접 remote push를 시도하면 기본 설정에서 차단 또는 일시 중단된다.
- 사용자가 예외를 승인할 때 대상 path, command, 범위와 위험을 확인할 수 있다.
- provider capability 차이와 관계없이 최소한 cwd 고정, push 차단과 사후 변경 검증이 적용된다.

## 6. Harness 보드를 MCP 서버로 노출

### MCP server

- [ ] 로컬 stdio 기반 `harness-mcp-server` entry point를 추가한다.
- [ ] desktop 또는 별도 process 연결이 필요한 경우에만 loopback tool bridge와 일회성 bearer token을 사용한다.
- [ ] MCP tool input과 output schema를 versioning하고 기존 Harness API·CLI service를 재사용한다.
- [ ] read tool과 write tool의 권한 scope를 분리한다.
- [ ] project와 task 범위를 벗어나는 요청을 차단하고 호출 client, tool, 대상과 결과를 audit event로 기록한다.
- [ ] MCP 호출이 command approval, dependency, scheduler와 merge approval을 우회하지 못하게 한다.

### 초기 tool 목록

- [ ] `list_projects`, `get_project`, `get_project_health`를 제공한다.
- [ ] `list_tasks`, `get_task`, `create_task`, `update_task`, `comment_task`를 제공한다.
- [ ] `schedule_task`, `decompose_task`, `list_runs`, `get_run`을 제공한다.
- [ ] `list_interactions`, `resolve_interaction`, `list_approvals`를 제공한다.
- [ ] 변경 도구는 dry-run 또는 preview를 지원하고 위험 동작은 기존 approval을 생성한다.

### Client 연결

- [ ] Cursor의 MCP 설정에 Harness server를 등록하는 예시를 제공한다.
- [ ] Claude Desktop, Codex와 범용 MCP client용 설정 예시를 제공한다.
- [ ] client 연결 상태, 노출 tool과 permission scope를 Settings에서 확인하게 한다.
- [ ] 연결 진단 command와 최소 read-only smoke test를 제공한다.

### 완료 조건

- Cursor를 포함한 MCP client가 Harness project와 task를 조회할 수 있다.
- 허용된 client는 동일한 service 경계를 통해 task 생성과 interaction 응답을 수행할 수 있다.
- MCP를 통한 모든 변경이 UI, API, CLI와 같은 policy 및 audit 규칙을 따른다.

## 7. OpenTelemetry 기반 실행 추적

### 계측 범위

- [ ] trace와 span 명명 규칙 및 공통 attribute를 정의한다.
- [ ] `plan.create`, `draft.review`, `draft.apply`를 계측한다.
- [ ] `scheduler.dispatch`, `provider.run`, `provider.event`, `interaction.wait`, `interaction.resume`을 계측한다.
- [ ] `review.open`, `review.comment`, `mcp.tool`, `handoff.evaluate`, `workspace.commit`, `merge.apply`, `recovery.audit`를 계측한다.
- [ ] project, task, run, agent, provider id를 민감하지 않은 correlation attribute로 기록한다.
- [ ] 실패, timeout, 사용자 거절, 재시도와 재개 횟수를 span event로 기록한다.

### 운영과 보안

- [ ] OpenTelemetry는 기본 비활성화하고 설정 또는 환경변수로 활성화한다.
- [ ] OTLP exporter를 지원하되 Jaeger나 Phoenix를 필수 의존성으로 만들지 않는다.
- [ ] prompt, 코멘트, 파일 내용, API key와 명령 전문은 기본적으로 trace에 저장하지 않는다.
- [ ] 로컬 SQLite audit event와 trace id를 연결해 UI 기록에서 외부 trace를 찾을 수 있게 한다.
- [ ] exporter 장애가 작업 실행을 실패시키지 않도록 비차단 방식과 timeout을 적용한다.
- [ ] 개발용 선택적 observability compose 구성을 제공한다.

### 완료 조건

- 하나의 카드 작성 검토부터 실행, 대기, 재개, handoff, 병합까지 같은 trace 계보로 확인할 수 있다.
- telemetry를 끈 기본 로컬 실행에는 별도 인프라가 필요하지 않는다.
- 민감한 사용자 콘텐츠가 기본 설정의 span attribute와 event에 포함되지 않는다.

## 8. README를 협업 시나리오와 설치 과정 중심으로 개편

- [ ] 첫 문단에서 Harness가 해결하는 문제와 대상 사용자를 설명한다.
- [ ] 긴 MVP 기능 목록보다 `사람과 에이전트가 하나의 카드에서 협업하는 방식`을 먼저 보여준다.
- [ ] 카드 초안 작성 → 실시간 리뷰 → 내용 반영 → 실행 → 질문 대기 → 응답과 재개 → 검토와 병합 시나리오를 작성한다.
- [ ] 주요 화면 이미지 또는 짧은 데모를 추가한다.
- [ ] 제품 철학, 대표 시나리오, 핵심 개념, 아키텍처, 시작하기, 상세 기능 순으로 문서를 재구성한다.
- [ ] local-first, 프로젝트 로컬 데이터, provider 확장성, Git worktree 격리라는 차별점을 명확히 설명한다.
- [ ] 현재 지원 범위와 아직 구현되지 않은 기능을 구분한다.
- [ ] 기존 CLI와 상세 설정 예시는 별도 섹션 또는 문서로 이동해 첫 사용 흐름을 단순화한다.

### 설치 및 연결 안내

- [ ] Node.js, pnpm, Git과 최소 한 개의 LLM CLI 등 필수 prerequisite와 지원 version을 명시한다.
- [ ] source 설치를 `git clone` → `pnpm install` → `pnpm dev` 순서로 안내한다.
- [ ] production build와 단일 local server 실행을 `pnpm build` → `pnpm start` 순서로 안내한다.
- [ ] macOS, Windows, Linux별 폴더 선택기와 필요한 system dependency 차이를 설명한다.
- [ ] Codex, Claude Code, Gemini, Ollama와 Cursor CLI의 설치·로그인·provider 설정 예시를 제공한다.
- [ ] provider command가 OS별 key에서 어떻게 선택되는지 최소 예시와 확인 command를 제공한다.
- [ ] Cursor와 다른 client에 Harness MCP server를 등록하는 설정 예시를 제공한다.
- [ ] 첫 project 등록, Git 초기화, 첫 agent 생성, 첫 task 실행과 승인까지의 quick start를 작성한다.
- [ ] port 충돌, provider executable 미탐지, 로그인 실패, Git 초기 commit 부재와 MCP 연결 실패 해결법을 추가한다.
- [ ] 아직 제공되지 않는 desktop 설치 방법은 지원되는 것처럼 작성하지 않고 source/local server 설치와 구분한다.

### README 완료 조건

- 처음 읽는 사용자가 제품의 목적과 대표 협업 흐름을 기능 목록보다 먼저 이해할 수 있다.
- 문서의 대표 시나리오가 실제 UI와 동작한다.
- 필수 설치와 첫 카드 실행 절차를 짧은 흐름으로 재현할 수 있다.
- 각 provider와 MCP 연결 안내가 실제 smoke test command로 검증된다.

## 진행하면 좋은 것들 (자동 진행 대상 아님)

이 section은 일반적인 `todo 진행해줘` 요청의 선택·구현 대상에서 제외한다. 사용자가 아래 항목을 이름으로 명시해 요청한 경우에만 별도 작업으로 진행한다.

### Worktree별 개발 서버 Preview

- [ ] project별 기본 dev server command와 readiness check를 정의한다.
- [ ] worktree마다 충돌하지 않는 port와 환경변수를 할당한다.
- [ ] preview URL, PID, log와 `booting`, `live`, `crashed`, `stopped` 상태를 저장한다.
- [ ] 카드에서 preview 시작·중지·재시작과 외부 브라우저 열기를 제공한다.
- [ ] 서버 재시작 시 남은 preview process를 탐지하고 정리한다.
- [ ] 여러 service를 가진 monorepo와 Docker 기반 개발 환경의 preview 전략을 별도로 설계한다.
- [ ] preview command는 사용자 승인 및 project policy를 통과하고 secret을 UI와 log에 노출하지 않는다.

## 권장 구현 순서

1. 공통 provider capability와 versioned 실시간 event 계약
2. Cursor CLI provider와 provider event adapter
3. draft 세션, revision, 코멘트 데이터 모델
4. 기획 리뷰어·예외 상황 감지 에이전트와 실시간 코멘트 UI
5. 기획 에이전트의 `내용 반영` 및 diff·승인·되돌리기
6. 범용 interaction 모델과 `suspended` run 상태
7. 질문·승인·권한 요청 후 실행 재개
8. 구현 완료 HTML 보고서, 변경량 지표와 완료 후 side diff 리뷰
9. worktree 경계 감지, pre-push hook과 다층 보호
10. Harness MCP server와 Cursor 연결
11. 주요 실행 구간 OpenTelemetry 계측
12. 완성된 실제 흐름과 검증된 설치 방법을 기준으로 README 개편

`진행하면 좋은 것들`의 Worktree 개발 서버 Preview는 위 순서에 포함하지 않는다.

## 전체 완료 정의

- 카드 작성 단계와 실행 단계 모두에서 인간과 에이전트의 대화가 task 맥락에 영속화된다.
- 사용자의 명시적 결정 없이 에이전트가 초안 변경이나 위험 작업을 수행하지 않는다.
- 서버 재시작 후에도 draft, interaction, suspended run을 복구할 수 있다.
- Cursor CLI와 기존 provider가 공통 event 계약 또는 안전한 fallback으로 실행된다.
- 완료된 카드에서 구현 완료 HTML 보고서, 검토 우선 파일과 변경 파일별 side diff를 확인할 수 있다.
- inline review comment는 실행 완료 후에만 작성할 수 있다.
- agent의 worktree 밖 변경과 직접 remote push가 다층 보호 정책을 통과하지 못한다.
- Cursor를 포함한 MCP client가 Harness policy를 우회하지 않고 보드를 사용할 수 있다.
- UI, API, CLI와 timeline이 동일한 상태를 보여준다.
- 핵심 흐름에 자동 테스트와 회귀 테스트가 추가된다.
- README의 협업 시나리오와 설치·provider·MCP 안내가 실제 구현과 일치한다.
