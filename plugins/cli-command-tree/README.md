# claude-cli-spec

**세션 시작마다 `claude` CLI 의 명령 이름 트리를 컨텍스트에 넣는다.**

## 왜

`claude plugin update` 라는 명령이 있는 줄 모르고 `claude plugin install` 만 반복한 세션이 있었다.
install 은 이미 깔린 플러그인에 대해 "already installed" 로 조용히 넘어갈 뿐이라 갱신이 되지 않았다.
`--help` 를 치기는 했으나 `head -14` 로 잘라 봐서 그 뒤에 있던 `update` 를 놓쳤다.
지적은 **"네 명령인데 네가 모르냐"** 였다.

**놓친 것은 옵션 상세가 아니라 "그 명령이 존재한다"는 사실이다.** 그래서 이름만 넣는다.
상세는 필요할 때 `claude <경로> --help` 로 본다.

- 이름만: **409 바이트 · 18 줄 · 명령 54개** (claude 2.1.263)
- 옵션까지: 34KB — 매 세션 값으로는 낼 수 없고, 이번 실패는 옵션 문제가 아니었다

## 들어가는 것

```
agents
attach
auth: login logout status
auto-mode: config critique defaults reset
doctor
gateway
import
install
logs
mcp: add add-from-claude-desktop add-json get list login logout remove reset-project-choices serve
plugin: details disable enable eval(init) init install list marketplace(add list remove update) prune tag uninstall update validate
project: purge
respawn
rm
setup-token
stop
ultrareview
update
```

머리말(버전)과 꼬리말(`상세는 claude <경로> --help`) 두 줄이 붙는다.
JSON 이 아니라 평문이다 — 컨텍스트에 들어가는 텍스트라 구조가 필요 없다.
3단계는 괄호로 계층을 살린다: `eval(init)`, `marketplace(add list remove update)`.

## 캐시가 요점이다

`claude --version` 이 캐시 키다. `~/.cache/claude-cli-spec/<version>.txt`
(`$XDG_CACHE_HOME` 존중, 원자적 rename 으로 교체, 지난 버전 파일은 자동 정리).

- **평소**: 파일 읽기 한 번 — 실측 **~35ms**
- **버전이 바뀐 첫 세션**: `--help` 를 ~25회 스폰해 다시 파싱 — 실측 **~1.5s**
- 훅 timeout 은 5초, 내부 deadline 은 3.5초. 넘기면 **조용히 아무것도 내지 않는다**.
  세션 시작을 막는 것보다 이번 세션에 트리가 없는 편이 낫다.

**그래서 낡지 않는다** — CLI 가 갱신되면 다음 세션에 자동으로 다시 뜬다.

## 파싱 — claude 는 commander.js 다

바이너리에 `outputHelp`·`addCommand`·`createCommand` 가 있고, `install|i`·`stop|kill` 별칭 표기와
`display help for command` 문구가 commander 의 것이다.
**`claude` 자체에는 스키마 덤프가 없다** — `claude schema`·`commands`·`introspect` 는 전부
최상위 도움말로 떨어진다(모르는 인자를 프롬프트로 받아넘긴다). 그래서 `--help` 를 읽는 수밖에 없다.

**판별은 `Usage:` 첫 줄 하나로 끝난다.** commander 가 경로를 그대로 에코한다.

| 첫 줄 | 뜻 |
|---|---|
| `Usage: claude plugin\|plugins [options] [command]` | 유효 · 하위 있음(`[command]`) |
| `Usage: claude doctor [options]` | 유효 · 하위 없음 |
| `Usage: claude [options] [command] [prompt]` | `claude nosuchcmd --help` — 그 명령이 없다 |

인자 표기(`<id>`, `[target]`, `<id>|--all`)는 경로가 아니다. 별칭은 첫 이름으로 정규화한다
(`plugin|plugins` → `plugin`). commander 가 자동생성하는 `help [command]` 는 버린다.

## 함정 넷 — 이 파서가 막고 있는 것

셋 다 **결과가 그럴듯해서 개수를 세기 전에는 안 드러난다.** 그래서 검증과 테스트가 붙어 있다.

**1. 없는 명령의 `--help` 가 오류가 아니다.** 가장 가까운 유효 조상의 도움말이 나온다
(`claude nosuchcmd` → 최상위, `claude plugin nosuchcmd` → `plugin`, `claude plugin eval nosuchcmd` → `plugin eval`).
그것을 하위 목록으로 읽으면 상위가 통째로 복사된다 — `update: agents attach auth …` 같은 헛것이 생긴다.
→ **에코된 경로가 요청 경로와 정확히 같을 때만** 유효로 본다.

**2. 소제목이 이름 자리에 온다.** `  Examples:` 가 정확히 2칸 들여쓰기다.
→ commander 의 명령 이름은 콜론으로 끝나지 않는다. 콜론으로 끝나는 토큰은 소제목으로 분류한다
(버리되, "알고 버린 것"으로 기록해 검증에서 미분류와 구분한다).

**3. 인자 있는 명령을 놓친다 — 이게 제일 컸다.**
`^ {2}(\S+)(?:\s{2,}(.*))?$` 로 잡으면 `  agents [options]    Manage background agents` 가 **매치에 실패**한다.
이름과 `[options]` 사이가 한 칸이기 때문이다. **최상위 18개가 8개로 반토막** 났다.
→ 이름 뒤 인자 표기는 이름의 일부가 아닌 것으로 다루고 **첫 토큰만** 취한다.

**4. 설명 안의 예시 블록에서 조기 종료한다.**
`claude mcp --help` 는 첫 명령(`add`) 설명에 예시가 끼어 있고, 그 안의 `# Add HTTP server:` 가
콜론으로 끝나 블록 끝으로 오인된다. **`mcp` 하위 10개가 1개로 줄었다.**
→ 빈 줄이나 콜론에서 멈추지 않는다. 블록은 **0칸 들여쓰기(다음 섹션)** 에서만 끝나고,
**정확히 2칸만** 이름 자리다.

## 검증

```
node scripts/clispec.mjs --verify
```

두 가지를 본다.

1. **미분류 줄이 없는가** — 도움말 `Commands:` 블록의 2칸 들여쓰기 줄은 하나도 빠짐없이
   `이름` / `소제목` / `버린 help` 중 하나로 분류돼야 한다. 함정 3 처럼 이름을 통째로 놓치면
   그 줄이 미분류로 남아 여기서 걸린다.
2. **깊이별 전수 대조** — 도움말에서 뽑은 이름 집합과, 산출된 트리를 **되읽어** 얻은 이름 집합을
   깊이별로 대조해 **빠짐·잉여를 둘 다** 출력한다.

```
claude 2.1.263
명령 54개 (1단계 18 · 2단계 31 · 3단계 5)
409 바이트 · 18 줄
  1단계: 도움말 18 ↔ 산출물 18 · 빠짐 0 · 잉여 0
  2단계: 도움말 31 ↔ 산출물 31 · 빠짐 0 · 잉여 0
  3단계: 도움말 5 ↔ 산출물 5 · 빠짐 0 · 잉여 0
검증 통과
```

문제가 있으면 exit 1.

## 테스트

```
node --test 'tests/*.test.mjs'
```

> `node --test tests` (디렉터리 형태)는 이 레포에 `package.json` 이 없어 Node 24 에서
> 엔트리 모듈로 해석돼 실패한다. 글롭 형태를 쓴다.

두 층이다.

- **고정 도움말(`tests/fixtures/*.txt`) 기반** — 실제 `claude --help` 출력을 그대로 박제해 뒀다.
  설치된 CLI 버전과 무관하게 **함정 4개를 영구히 잠근다.** 파서를 건드리다 함정 3 을 재발시키면
  최상위 18개 단언에서 즉시 깨진다.
- **실제 CLI 기반** — 개수를 잠근다: 최상위 **18** · `mcp` **10** · `plugin` 직속 **13** · 전체 **54**,
  그리고 트리 전문이 `tests/fixtures/tree-2.1.263.txt` 와 일치해야 한다.
  버전이 오르면 여기가 깨지고, **그 깨짐 자체가 정보다** — 무엇이 늘고 줄었는지 diff 로 보인다.
  실패 메시지가 기준선 버전과 설치본 버전을 함께 알려 준다.

기준선을 갱신하려면 `tests/clispec.test.mjs` 의 `BASELINE_VERSION`·`EXPECTED` 와
`tests/fixtures/tree-<버전>.txt` 를 함께 고친다.

## 사용

```
node scripts/clispec.mjs              # 캐시 우선, 컨텍스트 텍스트 그대로
node scripts/clispec.mjs --tree       # 트리만
node scripts/clispec.mjs --no-cache   # 캐시 무시하고 새로 파싱
node scripts/clispec.mjs --verify     # 전수 대조 검증
node scripts/clispec.mjs --cache-path # 캐시 파일 위치
```

| 환경변수 | 뜻 |
|---|---|
| `CLAUDE_CLI_SPEC_BIN` | `claude` 실행 파일 경로를 못박는다 (기본: PATH → `~/.local/bin` → `/usr/local/bin` → `/opt/homebrew/bin`) |
| `CLAUDE_CLI_SPEC_DEADLINE_MS` | 훅 내부 deadline (기본 3500) |
| `XDG_CACHE_HOME` | 캐시 위치 (기본 `~/.cache`) |

## 범위 밖

- **옵션은 담지 않는다.** 34KB 가 되고, 이번 실패는 옵션 문제가 아니었다.
- **다른 CLI 는 담지 않는다.** `tirno` 는 이미 `tirno schema` 가 있어 파싱이 필요 없다.
