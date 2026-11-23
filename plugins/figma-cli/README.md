# figma-cli — Figma Dev Mode MCP 를 셸에서

Figma 데스크톱 앱은 로컬에 Dev Mode MCP 서버를 띄운다(`http://127.0.0.1:3845/mcp`).
`fig` 는 그 서버의 도구 10개를 셸에서 부르는 CLI 다. 의존성 없음 — bun 의
`fetch`/`Buffer` 와 `node:` 내장 모듈만 쓰고, 실행에 bun 이 필요하다.

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
찾기 — 문서 전체에서 노드를 찾는다
fig find  <패턴> [대상]   노드 이름을 정규식으로 검색, 조상 경로까지 (기본 50건까지)
fig tree  [대상]          메타데이터를 요약 트리로 (대상 기본값 0:0 = 문서 루트)
fig index [URL|파일키]    문서 전체를 받아 저장. find·tree 에 --index 를 주면 저장본으로 답한다

보기 — 노드 하나를 자세히 본다
fig meta  [대상]          노드 트리 메타데이터 XML. get_metadata
fig ctx   [대상]          디자인 컨텍스트(참조 코드·토큰). get_design_context
fig vars  [대상]          변수 정의. get_variable_defs
fig shot  [대상]          PNG 스크린샷. get_screenshot

저수준
fig tools                 서버가 제공하는 도구 목록과 인자
fig call  <도구> [JSON]   도구를 이름으로 직접 호출
```

**대상**은 Figma URL 을 그대로 붙여넣거나(`?node-id=7327-61763`), `7327-61763`,
`7327:61763` 을 준다. 생략하면 Figma 에서 지금 선택한 노드를 쓴다.

찾기 옵션: `--type T` · `--prop 이름=값` · `--square N|A-B` · `--limit N` · `--index` ·
`--hidden` · `-d/--depth N`. 공통 옵션: `-o/--out FILE` · `--json` · `--raw` ·
`--timeout SEC` · `--no-cache` · `-h/--help`. 엔드포인트는 `FIG_MCP_URL` 로 바꾼다.

```bash
fig tree                                          # 캔버스 목록
fig find 'modalHeader'                            # 이름으로 찾기
fig index && fig find . --type instance --square 8-48 --index   # 아이콘 인스턴스 후보
fig find . --prop Orientation=Portrait --index    # 변형 속성으로 찾기
fig ctx 7327-61763 -o header.tsx                  # 큰 출력은 파일로 → grep
fig shot 'https://figma.com/design/…?node-id=7327-61763' -o header.png
fig tree --json | jq '.[] | select(.width > 1000) | {name, width}'
fig call get_motion_context '{"nodeId":"1:2","recursive":true}'
```

`add_code_connect_map` 과 `send_code_connect_mappings` 는 Figma 문서를 바꾸는 쓰기
도구다 — `fig call` 로만 닿게 두었다.

호출 기록 — 보낸 요청을 센다
fig usage                 이 CLI 가 보낸 요청의 집계, 같은 도구·노드의 반복 호출, 마지막 상한 통지, 예산 설정

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
- **응답 대기 상한은 15초다.** 대기 상한의 관례값이고 측정으로 정한 값이 아니다(정상 상태에서
  가장 느린 호출은 문서 전체 읽기 1.6초였다). 넘으면 도구 이름과 초를 알리는 오류로 끝나고,
  `--timeout` 으로 바꾼다. 연결 거부(`ECONNREFUSED`)와는 다른 메시지다.
- **서버가 활성 탭이 파일이 아니라고 답하면** 한국어로 대처를 안내한다. 서버 원문은
  괄호로 함께 낸다.
- **로컬 색인으로 답하는 명령과 서버로 가는 명령은 출력 크기와 호출 수의 균형이 다르다.** `find`·`tree --index`
  는 호출 상한을 쓰지 않으니 토큰만 비용이라 기본 출력을 작게 두고 필요하면 다시 조회한다. `ctx`·`vars`·`shot`
  과 문서 전체 읽기는 호출 수와 토큰이 둘 다 비용이라 필요한 노드를 정확히 지정해 받는다. `fig usage` 의 `대화로
  나간 출력` 은 명령별 stdout 바이트(횟수·합계·최대)로 이 균형을 재는 값이다. `-o` 로 파일에 쓴 출력은 세지 않고,
  바이트 수일 뿐 토큰 수가 아니다.
- **`find` 는 stdout 에 50건까지만 낸다.** 남은 건수를 stderr 로 알린다. `--limit 0` 은
  제한 없음이고, `-o` 로 파일에 쓸 때는 전부 쓴다. `--json` 도 같은 상한을 받지만
  잘려도 유효한 JSON 배열이다.
- **`--type`·`--prop`·`--square` 는 `findNodes` 한 곳에서 거른다.** 색인으로 찾을 때와
  서버에서 바로 받아 찾을 때가 같은 함수를 지나므로 결과가 같다. 이름 패턴은 대소문자를
  무시하는 정규식이고, `--prop` 은 이름을 `, ` 로 나눈 조각이 `이름=값` 과 정확히
  같을 때만 일치한다.
- **색인은 받아 온 `get_metadata` 원문을 gzip 한 파일 한 벌이다**
  (`${XDG_CACHE_HOME:-~/.cache}/fig/index.xml.gz` 와 메타 `index.json`). 이 문서
  16,790노드 기준 160KB, 읽기·파싱·검색 약 30ms 다. 노드 수에 비례해서 10배면 약
  0.3초로 추정한다(실측 아님). 서버가 문서 변경을 알려 주지 않으므로, 만든 지 5분이 지난
  색인은 조회마다 색인의 마지막 노드를 서버에 물어 id·타입·이름·좌표·크기·숨김이 같은지
  확인한다(호출 1회, 약 0.5초). 다르거나 노드가 없으면 `fig index` 로 다시 만들라고 알리고
  답하지 않는다. 5분 미만이면 서버를 부르지 않고(호출 0회) 답하며 stderr 에 `서버 확인
  생략` 을 표시한다. 그 사이 다른 파일을 열었거나 편집했다면 틀린 답이 나올 수 있어
  `fig index` 로 다시 만든다. 5분(`INDEX_TRUST_MS`)은 읽기 호출 상한을 아끼려고 정한
  값이고 측정으로 근거를 댈 수 있는 값이 아니다. 파일이 한 벌이라 다른 문서의 색인이
  섞이지는 않는다.
- **`fig index <URL>` 은 파일의 마지막 편집 기록을 같이 저장한다.** Figma REST
  `GET /v1/files/:key/meta` 의 `last_touched_at` 을 색인 메타(`file.key`·`file.lastTouchedAt`)에
  넣고, `--index` 조회 때 같은 호출로 현재 값과 비교한다(MCP 호출 0회, 0.4~1.2초). 같으면 5분이
  지난 색인도 그대로 답하고, 다르면 답하지 않고 다시 만들라고 알린다. 개인 파일에서 노드를
  복제하기 전후로 재 보니 `last_touched_at` 은 편집 후 바뀌고 편집이 없으면 그대로였다
  (`version` 은 바뀌지 않아 쓰지 않는다. `docs/rest-read-path.md`). 편집 직후 갱신까지의 지연은
  재지 않았다. 토큰은 `FIGMA_TOKEN` 환경변수가 `${XDG_CONFIG_HOME:-~/.config}/fig/token`
  (base64 한 줄)보다 앞선다. 토큰이 없거나 REST 가 실패하면 stderr 로 사유를 알리고 5분 규칙으로
  답한다. 파일 URL 없이 만든 색인에는 기록이 없어 REST 를 부르지 않는다.
- **끝낼 때 `process.exit` 를 부르지 않고 `process.exitCode` 만 정한다.** `process.exit` 는
  파이프로 아직 못 나간 출력을 버려서, 128KB 를 넘는 출력이 `| grep`·`| wc` 에서 잘린다
  (실측: bun 131072B, node 65536B 에서 멈추고 파일 리다이렉트는 전부 나왔다). 이벤트 루프가
  비도록 두면 3MB 도 전부 나오고 종료도 늦어지지 않는다(bun 약 20ms, node 약 60ms).
- **서버로 나가는 요청은 전부 원장에 남는다.** MCP 는 `post`, REST 는 `fetchFileMeta` 가 유일한
  송신 지점이라 두 곳에서 한 줄씩 `${XDG_STATE_HOME:-~/.local/state}/fig/calls-<UTC 날짜>.jsonl` 에
  덧붙인다(시각·백엔드·종류·도구·상태·소요 시간·바이트·명령 이름, 응답 본문과 토큰은 없다).
  날짜별 파일이라 기록 비용은 호출당 일정하고 읽기는 최근 이틀 분량으로 끝난다.
  `initialize`·`tools/list` 도 기록하지만 예산에는 `tools/call` 과 REST 만 센다. 세션이 만료돼 404 를 받은
  `tools/call` 은 도구가 실행되지 않았으므로(재초기화 뒤 다시 보낸다) 예산과 반복 호출 집계에서 뺀다. `tools/call` 에는
  대상 노드 id(`node`, 대상을 생략해 선택 노드를 쓰면 `null`)가 같이 남고, `fig usage` 가 최근 24시간에
  같은 도구·노드를 다시 부른 횟수를 센다. 응답을 노드 단위로 캐시할 가치를 가늠하는 값이며, 인자 중
  `nodeId` 외의 값(`forceCode` 등)이 달라도 같은 호출로 센다.
- **막는 것이 기본이고 `--force` 로만 보낸다.** 호출 직전에 원장을 읽어 두 가지를 본다. 설정한 예산
  (`FIG_BUDGET_MCP_DAY`: 최근 24시간, `FIG_BUDGET_REST_MIN`: 최근 1분)에 닿았는지, 서버가 상한을
  알린 뒤 보류 시간이 안 지났는지(MCP 1시간, REST 는 429 의 `Retry-After`). 걸리면 서버에 보내지
  않고 사유와 `--force` 를 안내해 종료 코드 1 로 끝나며, `--force` 를 주면 경고만 하고 보낸다.
  REST 확인이 막히면 `--index` 조회는 5분 규칙으로 돌아간다. 예산의 기본값은 없다 — 상한 수치는
  이 환경에서 검증하지 못했다. MCP 보류 1시간은 서버가 풀리는 시각을 알려 주지 않아 정한 관례값이다.
- **집계는 하한값이다.** 이 CLI 가 보낸 요청만 센다. 같은 계정의 다른 클라이언트(앱 자체, 다른 세션)의
  호출은 보이지 않고, 합산 여부도 문서에 없다. 하루는 최근 24시간으로 센다.
- **호출 상한 오류는 한국어로 안내한다.** 서버가 읽기 도구에 `Rate limit exceeded` 를 내면
  막히는 명령과 공식 문서 주소를 알리고 서버 원문을 괄호로 함께 낸다. 상한 수치는 문서가
  바뀔 수 있어 코드에 적지 않는다.
- **`clientLanguages`/`clientFrameworks` 는 옵션으로 열지 않았다.** 스키마 설명이
  로깅 전용이라 했고, `vue` 와 `unknown` 으로 같은 노드를 불러 출력이 바이트까지
  동일한 것을 확인했다. 항상 `unknown` 을 보낸다.

## 테스트

```bash
cd plugins/figma-cli && bun test tests/
```

네트워크를 타지 않는 순수 함수(URL 파싱·SSE 파싱·XML 파싱·트리·검색·필터·인자·서버 문구
분리·오류 메시지)와 색인 저장·읽기(임시 디렉터리), 로컬 루프백 가짜 서버로 CLI 를 실제 실행하는
시험(큰 출력의 셸 파이프, 상한 오류의 종료 코드)만 잠근다. Figma 앱이 없는 곳에서도 돈다.
