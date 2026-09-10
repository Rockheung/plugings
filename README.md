# plugings

> [Claude Code](https://claude.com/claude-code) 플러그인 마켓플레이스 — by [Rockheung](https://github.com/Rockheung).

## 설치

```
/plugin marketplace add Rockheung/plugings
/plugin install <플러그인>@plugings    # 예: /plugin install secrets@plugings
```

## 플러그인

| 플러그인 | 설명 |
|---|---|
| **[config-map](./plugins/config-map)** | Claude Code 설정을 **경로 상속(cascade)까지 해소**해 인터랙티브 지형도로 시각화. `~/.claude`(base) 위에 각 경로가 얹는 델타(플러그인·MCP·훅·CLAUDE.md)를 실측해, 경로를 고르면 그 지점의 유효 설정을 origin 배지로 보여준다. 민감값 마스킹. |
| **[confirm-gate](./plugins/confirm-gate)** | 위험·비가역 Bash 명령을 실행 직전 **15초 native 다이얼로그로 게이트**. 무응답 시 클래스별 기본값(비가역=deny, 가역=allow). 한글 명령도 안 깨짐. |
| **[rectify](./plugins/rectify)** | **세션 자기교정** — 행위를 `CLAUDE.md` 규칙과 대조해 위반을 가려 Lessons Learned에 기록·유지. magistrate → examiner(분리·적대 감사) → chronicler. 사후 + `rectify-watch` 라이브. |
| **[lore](./plugins/lore)** | 미지·레거시 코드베이스를 규율 있게 학습해 **자가유지 지식베이스**를 쌓는 3-에이전트. Scout(발견) → Archivist(종합·기록) → Curator(재검증). 특정 지식레포에 비종속. |
| **[secrets](./plugins/secrets)** | 비밀값(로그인·API 키)을 memory 평문 대신 **GPG 대칭키로 `~/.secrets/` 에 암호화** 저장하는 스킬 + CLI(`secret-store/get/list`). passphrase 는 사람의 대화형 셸에서만 — 비대화형(Claude Code)에선 pinentry 없이 gpg-agent 캐시(12h)로만 조회. |
| **[lens](./plugins/lens)** | Claude Code 세션을 들여다보는 **범용 렌즈**. `monitor-session`: 세션/sub-agent jsonl 실시간 stream, `--for "<목적>"`로 그 목적에 맞는 라인만 surface. |
| **[git-multi-account](./plugins/git-multi-account)** | 한 머신의 여러 git/GitHub 계정 전환을 *제거* — 폴더 위치로 identity·서명·push 인증 자동 라우팅. |
| **[session-delegation](./plugins/session-delegation)** | 다른 Claude 세션에 일을 맡기고 받는 절차. 주소는 `ListAgents` 의 이름이고 **관측자마다 다르므로** `--remote-control <이름>` 으로 못박는다. herdr 로 조작할 세션은 `--settings '{"tui":"default"}'` 로 — 풀스크린은 alternate screen 이라 `pane read` 가 현재 화면 이상을 못 읽는다. 폴링 금지, 회신은 검증 후 인용. |
| **[figma-cli](./plugins/figma-cli)** | Figma Dev Mode MCP(`127.0.0.1:3845`)를 셸에서 쓰는 무의존성 CLI(`fig`). 시안 URL 을 그대로 붙여넣으면 컨텍스트·메타데이터·스크린샷·문서 트리·이름 검색이 나온다. **MCP 도구로 부르면 노드 하나가 65KB 씩 대화 컨텍스트로 들어오는 것**이 존재 이유 — 파일로 받아 `grep` 한다. 세션 id 캐시로 왕복 3→1, 만료는 404 보고 자동 재초기화. |
| **[claude-cli-spec](./plugins/claude-cli-spec)** | 세션 시작마다 `claude` CLI 의 **명령 이름 트리**(~0.4KB)를 컨텍스트에 주입. 놓치는 건 옵션 상세가 아니라 "그 명령이 존재한다"는 사실이므로 이름만 담는다(옵션까지면 34KB). `--help` 를 파싱해 `claude --version` 을 키로 캐시 — 평소 파일 읽기 한 번, 버전이 바뀔 때만 재파싱. 파서 함정 4개를 fixtures 로 박제한 테스트 포함. |
| **[time-budget](./plugins/time-budget)** | Claude 에겐 경과 시간을 느끼는 **패시브 센서가 없다**는 전제에서, 느끼는 대신 조회·알람으로 바꾼다. `date` 프로브로 경과를 재고 백그라운드 트립와이어를 알람으로 쓴다. 타이머로 되는 것(턴 사이 경과·외부 장기작업 감시)과 안 되는 것(턴 내부 자기생성은 못 끊음)을 정직하게 가른다. |
| **[runbook-author](./plugins/runbook-author)** | 한 세션에서 시행착오 끝에 성공한 절차를 **다음 세션이 재발견 없이 재사용**하도록 런북 스킬로 박제하는 저작 방법론. 희소 자산은 "이 환경에서 통과한 구체" — 성공 코드 원문에 실패 변형을 병기하고, 낡는 값 대신 실측 절차를, 함정엔 사고 출처를 남긴다. 스킬(전문)+메모리 포인터(발견 경로) 2층. |
| **[php-lsp-proxy](./plugins/php-lsp-proxy)** | PHP LSP(intelephense)를 **stdio 프록시 멀티플렉서** 뒤에서 구동. 요청 uri 의 git toplevel 별로 인스턴스를 lazy spawn·라우팅(worktree 인식), `workspace/symbol` 은 fan-out 병합, 인덱싱 완료 전 요청은 게이트로 보류해 빈 결과 레이스를 막는다. 레거시 확장자(`.cm .sub .cls`)·`shortOpenTag` 지원. ⚠ 설치 후 `plugin.json` 경로 수정 필요. |
| **[mcp-atlassian](./plugins/mcp-atlassian)** | 로컬 Docker 의 `mcp-atlassian` 을 HTTP MCP 서버 `atlassian` 으로 **번들 등록**. 컨테이너 자체는 관리하지 않는다 — `reference/docker-compose.snippet.yml` 로 별도 기동. 같은 이름의 유저/프로젝트 스코프 MCP 가 있으면 그쪽이 우선. |
| **[mcp-slack](./plugins/mcp-slack)** | 로컬 Docker 의 `slack-explorer-mcp` 를 **토큰 주입용 caddy 프록시** 경유로 HTTP MCP 서버 `slack` 으로 번들 등록. 본체는 내부 네트워크에만 열려 있고 프록시만 노출 — 프록시가 `X-Slack-User-Token` 을 자동 주입해 둘이 하나의 MCP 진입점을 이룬다. |

## 여기 없는 것 — 다른 레포가 자기 스킬을 낸다

**[tirno](https://github.com/Rockheung/tirno)** — raw CDP 위의 다중 세션 브라우저 자동화
CLI. 스킬 5종(`tirno` 명령 레퍼런스 · `tirno-runbook` 작업 절차 · `tirno-mcp`
chrome-devtools-mcp 대응표 · `tirno-sw-override` · `tirno-origin-relay`)은 **도구 레포가
자기 마켓플레이스로 직접 낸다.**

```
/plugin marketplace add Rockheung/tirno
/plugin install tirno@tirno
```

여기로 복사해 오지 않는다. 스킬은 도구 버전과 같이 움직여야 하는데, 두 마켓플레이스에
올리면 낡은 쪽이 조용히 굳는다. 도구를 내는 레포가 스킬도 내는 것이 정본을 하나로 둔다.

## 철학

**추측 금지, 실측만.** 설정을 LLM 기억으로 짐작하지 않고, 읽기전용 스크립트가
실제 파일을 스캔한 값만 렌더한다. 민감값(토큰·env 값·파일 내용)은 스캔 단계에서 마스킹한다.

## 라이선스

MIT
