# figma-cli — Figma Dev Mode MCP 를 셸에서

Figma 데스크톱 앱은 로컬에 Dev Mode MCP 서버를 띄운다(`http://127.0.0.1:3845/mcp`).
`fig` 는 그 서버의 도구 10개를 셸에서 부르는 CLI 다. 의존성 없음 — bun 의
`fetch`/`Buffer` 만 쓴다.

## MCP 도구가 있는데 왜 CLI 인가

- **출력이 크다.** `get_design_context` 는 노드 하나에 65KB 를 낸다. MCP 도구로 부르면
  그게 통째로 대화 컨텍스트로 들어간다. 파일로 받아 `grep` 하면 필요한 줄만 본다.
- **다른 세션이 설정 없이 쓴다.** 세션마다 MCP 를 붙이는 것보다 스크립트 하나가 낫다.
- **셸 조합이 된다.** 파이프·리다이렉트·반복문에 넣을 수 있다.

## 설치

플러그인 설치 후 스크립트를 PATH 에 링크한다. **플러그인 캐시 경로는 버전(SHA)마다
바뀌므로** 링크 원본은 레포 체크아웃으로:

```bash
ln -sf <이 레포 체크아웃>/plugins/figma-cli/skills/figma/scripts/fig.mjs ~/.local/bin/fig
```

전제: Figma **데스크톱** 앱이 떠 있고(브라우저 버전에는 이 서버가 없다), 조회할 파일
탭이 활성 탭이고, Figma 메뉴 → Preferences → Enable local MCP server 가 켜져 있어야
한다. 안 켜져 있으면 `fig` 가 그 세 줄을 안내하고 종료한다.

## 명령

```
fig ctx   [대상]          디자인 컨텍스트(참조 코드·토큰). get_design_context
fig meta  [대상]          노드 트리 메타데이터 XML. get_metadata
fig shot  [대상]          PNG 스크린샷. get_screenshot
fig vars  [대상]          변수 정의. get_variable_defs
fig tree  [대상]          메타데이터를 요약 트리로 (대상 기본값 0:0 = 문서 루트)
fig find  <패턴> [대상]   노드 이름을 정규식으로 검색, 조상 경로까지
fig tools                 서버가 제공하는 도구 목록과 인자
fig call  <도구> [JSON]   도구를 이름으로 직접 호출
```

**대상**은 Figma URL 을 그대로 붙여넣거나(`?node-id=7327-61763`), `7327-61763`,
`7327:61763` 을 준다. 생략하면 Figma 에서 지금 선택한 노드를 쓴다.

옵션: `-o/--out FILE` · `--json` · `-d/--depth N` · `--hidden` · `--raw` ·
`--timeout SEC` · `--no-cache` · `-h/--help`. 엔드포인트는 `FIG_MCP_URL` 로 바꾼다.

```bash
fig tree                                          # 캔버스 목록
fig find 'modalHeader'                            # 이름으로 찾기
fig ctx 7327-61763 -o header.tsx                  # 65KB 를 파일로 → grep
fig shot 'https://figma.com/design/…?node-id=7327-61763' -o header.png
fig tree --json | jq '.[] | select(.width > 1000) | {name, width}'
fig call get_motion_context '{"nodeId":"1:2","recursive":true}'
```

`add_code_connect_map` 과 `send_code_connect_mappings` 는 Figma 문서를 바꾸는 쓰기
도구다 — `fig call` 로만 닿게 두었다.

## 설계

- **세션 캐시.** 호출마다 `initialize` → `notifications/initialized` → `tools/call` 로
  왕복이 셋이다. 세션 id 를 `~/.cache/fig/session` 에 캐시해 왕복 하나로 줄인다.
  서버가 세션을 얼마나 유지하는지는 확인하지 않았고, 확인할 필요도 없다 — 만료된
  세션으로 부르면 HTTP 404 `-32002 No session found for sessionId` 가 오므로, 그걸
  보고 한 번 재초기화하고 재시도한다.
- **XML 파싱.** `get_metadata` 는 한 줄에 요소 하나, 들여쓰기 2칸, 속성은
  `id name x y width height hidden` 뿐인 XML 을 낸다(2.6MB 문서 전량으로 확인).
  줄 단위로 읽어 조상 경로를 쌓으므로 이름에 `>` 나 따옴표가 들어와도 안 깨진다.
  이름의 `&gt;` 같은 엔티티는 풀어서 낸다 — 안 풀면 `find` 패턴이 화면과 안 맞는다.
- **`tree` 는 숨김 노드를 기본 제외한다.** 이 파일 기준 캔버스 14개 중 하나가
  `hidden="true"` 라 기본 출력은 13개다. 전부 보려면 `--hidden`.
- **`ctx` 는 스크린샷을 빼고 부른다**(`excludeScreenshot: true`). 텍스트 파이프에
  base64 는 쓸모가 없다. 그림이 필요하면 `fig shot`.
- **서버가 붙인 안내 문구는 결과에서 뺀다.** 응답의 텍스트 블록은 첫 블록만 데이터이고
  뒤따르는 블록은 전부 서버 안내다(`ctx` 는 코드 뒤에 변환 지시·node id 설명·이미지
  서버 설명·원격 서버 권유가 4블록으로 온다). 첫 블록이 "missing code connect mappings"
  안내이면 데이터가 없는 응답이다. 사용자 요청이 아닌 지시문이라 에이전트가 그대로 읽으면
  따를 수 있다. 개수만 stderr 로 알리고 원문은 `--raw` 로 본다.
- **`ctx` 가 코드 없이 Code Connect 안내만 받으면 오류다.** 종료 코드 1 과 함께
  `forceCode: true` 로 다시 부르는 `fig call` 명령을 낸다. 안내문이 시키는
  `disableCodeConnect` 는 서버 도구 스키마에 없는 인자라 권하지 않는다.
- **응답 대기 상한은 30초다.** 넘으면 도구 이름과 초를 알리는 오류로 끝나고,
  `--timeout` 으로 바꾼다. 연결 거부(`ECONNREFUSED`)와는 다른 메시지다.
- **`clientLanguages`/`clientFrameworks` 는 옵션으로 열지 않았다.** 스키마 설명이
  로깅 전용이라 했고, `vue` 와 `unknown` 으로 같은 노드를 불러 출력이 바이트까지
  동일한 것을 확인했다. 항상 `unknown` 을 보낸다.

## 테스트

```bash
cd plugins/figma-cli && bun test tests/
```

네트워크를 타지 않는 순수 함수(URL 파싱·SSE 파싱·XML 파싱·트리·검색·인자)만
잠근다. Figma 앱이 없는 곳에서도 돈다.
