---
name: session-delegation
description: |
  다른 Claude 세션에 일을 맡기고 결과를 받을 때 읽는다. 같은 머신의 세션, 새로 띄우는
  세션, 다른 머신(원격 서버)의 세션이 각각 절차가 다르다.
  ListAgents 나 SendMessage 를 부르기 전에, 그리고 herdr 로 pane 을 만들어 에이전트(claude·
  opencode)를 띄우기 전에 읽는다.
  "저쪽 서버에서 돌려줘", "여러 개 동시에 시켜", "다른 세션한테 물어봐", "원격에 붙어서
  작업" 같은 요청이 오면 해당한다. 결과를 받은 뒤 그대로 옮기지 않고 검증하는 절차도 담는다.
---

# session-delegation

## 주소

`ListAgents` 가 보여주는 이름이 주소다. 같은 머신이든 다른 머신이든 구분 없이 `SendMessage`
로 배달된다. 자기 자신은 목록에 없다.

| 표시 | 뜻 |
|---|---|
| `interactive` | 같은 머신의 세션 |
| `Remote Control` | 다른 머신 또는 웹·앱에서 접근 가능한 세션 |
| `offline` | 등록은 남았으나 프로세스가 죽음 |

**이름은 관측자마다 다르다.** 같은 세션인데 자기 머신에서는 작업 디렉토리 기반 이름으로,
다른 머신에서는 호스트명 접두사나 대화 제목으로 보인다. 한쪽에서 본 이름을 다른 쪽에
알려주며 "그 세션에 보내라"고 하면 상대는 그 이름을 찾지 못한다.

| 같은 세션을 | 자기 머신에서 | 다른 머신에서 |
|---|---|---|
| 예 | `rock-fb` | `mini-lcl-snoopy-hellman` |
| 예 | `heungjun-ed` | `Herdr 클라이언트 다중 서버 오케스트레이션` |

대화 제목이 정해지면 그것이 이름을 덮으므로 시간이 지나도 바뀐다. **`--remote-control
<이름>` 으로 띄운 세션은 그 이름이 그대로 `ListAgents` 에 뜬다.** 내가 띄우는 세션이면
이름을 직접 준다.

**한 번 주고받은 상대는 회신에 붙어 온 `from` 값(`bridge:session_...` 또는 `uds:...`)으로
기억한다.** 그게 세션 식별자라 이름이 바뀌어도 유효하다. 회신할 때는 받은 메시지의 `from`
을 그대로 `to` 에 넣는다.

**`ListAgents` 에는 머신 이름 컬럼이 없다.** 목록만 보고 어느 세션이 어느 머신인지 확정할
수 없다. 이름에서 추정할 수는 있으나 추정이다. 확실히 알아야 하면 그 세션에 직접 물어본다.

## 이미 떠 있는 세션에 맡기기

준비할 것이 없다. `ListAgents` 로 상대를 고르고 `SendMessage` 를 보낸 뒤 **턴을 끝낸다.**
응답은 나중에 `<cross-session-message>` 로 도착한다. 기다리며 폴링하지 않는다.

## 어디에 만드나 — cwd 가 다르면 새 workspace

**판별 기준은 cwd 하나다.** 맡길 일의 작업 경로가 지금 내 workspace 의 것과 다르면 pane 을
쪼개지 말고 workspace 를 새로 연다. 같은 경로의 일이면 pane 분할로 충분하다.

cwd 는 pane 을 만들 때 굳고 나중에 못 바꾸므로, "일단 옆에 pane 을 하나 파고 거기서 다른
레포를 보자" 는 되돌릴 수 없는 선택이 된다. 게다가 한 화면을 쪼갤수록 각 pane 이 좁아져
`pane read` 로 볼 수 있는 폭이 준다 — 갭이 큰 일을 옆에 붙이면 지금 하던 일까지 같이 좁아진다.

```sh
herdr workspace create --cwd <경로> --label <짧은 이름> --no-focus   # pane 이 하나 선 채로 온다
herdr pane list --workspace <id>                                     # 그 pane id 로 agent start
```

workspace label 은 그 경로를 알아보게 짓는다(기존 것들이 `foyer`·`veilcast` 처럼 디렉터리
이름을 쓴다). **`--no-focus` 로 만든다** — 사용자가 보고 있던 화면을 내 위임이 가져가지
않는다(`pane split`·`tab create` 도 같은 플래그를 받는다).

focus 로 사용자에게 무엇을 보여주려 하지 않는다. 0.9 부터 클라이언트마다 보는 workspace 와
tab 이 따로 놀아서, 내가 옮긴 focus 가 사용자 쪽 화면과 같다는 보장이 없다. 알릴 일이 있으면
알림으로 건다.

```sh
herdr notification show "<제목>" --body "<한 줄>" --sound request
```

**cwd 는 그 세션이 쓸 수 있는 스킬과 설정도 정한다.** `<cwd>/.claude/settings.local.json` 의
`skillOverrides` 가 스킬을 `off` 로 두고 있으면 그 경로에서 뜬 세션은 그 스킬을 못 부른다.
프로젝트 MCP·훅·`CLAUDE.md` 도 같은 경로 상속을 탄다. 스킬을 쓰게 할 세션이면 **그 스킬이
살아 있는 경로**를 골라야 하고, 확인은 만들기 전에 한다.

```sh
python3 -c "import json,os;p=os.path.expanduser('<cwd>/.claude/settings.local.json');\
print(json.load(open(p)).get('skillOverrides','없음') if os.path.exists(p) else '파일 없음')"
```

막힌 경로에서 띄워 놓고 파일을 직접 읽으라고 우회하면, **그 스킬을 스스로 찾는 단계가 검증에서
통째로 빠진다.** 스킬 사용을 재는 위임이라면 그것만으로 결과가 무의미해진다.

## 에이전트 이름 — `<머신>-<번호>-<주제>`

```
mini-tirno-1-headers      mbp-foyer-2-slt-verify      dgx-models-1-eval
```

- **머신**을 앞에 둔다. `ListAgents` 에는 머신 컬럼이 없어 목록만 보고는 어디서 도는지
  확정할 수 없다(위 "주소"). 이름이 그 자리를 메운다.
  **그 머신을 부르는 이름을 쓴다** — ssh config 의 `Host` 별칭이 있으면 그것, 없으면
  `hostname -s`. 별칭을 앞세우는 이유는 두 가지다: 원시 호스트명이 길고(로컬 macOS 가
  `heungjunpark-mbp` 다) 목록에서 자리를 먹는다, 그리고 이미 `mini`·`book`·`dgx`·`oci-ko` 로
  부르고 있는 머신에 호스트명을 쓰면 같은 머신이 두 이름으로 불린다. ssh 로 붙는 이름과
  일치해야 "어느 머신이냐" 가 바로 읽힌다
- **cwd** 는 그 세션의 작업 경로 basename 이다. workspace 를 가르는 기준이 cwd 이므로(위 절),
  이름에 넣으면 **어느 workspace 의 세션인지가 목록에서 바로 읽힌다.** 경로 전체가 아니라
  마지막 한 토막만 쓴다
- **번호**는 전역 순번이 아니라 **같은 머신·cwd 로 여러 개를 띄울 때의 구분자**다. 하나뿐이면
  `1` 로 둔다. 전역으로 세면 누가 관리하느냐는 문제가 생긴다
- **주제**는 무엇을 맡겼는지 한눈에 보이게. 경로가 아니라 일의 이름이다

네 토막이라 길어지기 쉽다. **각 토막을 짧게 잡는다** — 목록에서 잘리면 뒤쪽 주제부터 사라져
무엇을 맡긴 세션인지 알 수 없게 된다.

자동 이름(`foyer-e2` 처럼 `<디렉터리>-<해시>`)과 구분되는 것도 이득이다 — 내가 띄운 것과
남이 띄운 것이 목록에서 갈린다. `--remote-control <이름>` 으로 못박아야 그 이름이 그대로 뜬다.

## 새 세션을 만들어 맡기기

herdr 가 필요한 유일한 경우다. 순서가 중요하다.

```sh
# 0. 작업 경로가 신뢰 목록에 있는지 본다. 없으면 1단계가 대화상자에서 멈춘다
python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.claude.json"))).get("projects",{}).get("<경로>",{}).get("hasTrustDialogAccepted"))'

# 1. pane 을 만든다. cwd 는 시작할 때 굳고 나중에 못 바꾼다
herdr pane split --current --direction right --cwd <경로> --no-focus \
  --env CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false

# 2. 에이전트를 띄운다. 인자에 일감을 넣지 않는다
herdr agent start <name> --kind claude --pane <pane id> -- \
  --settings '{"tui":"default","spinnerTipsEnabled":false,"promptSuggestionEnabled":false}' \
  --permission-mode auto

# 3. 실제로 auto 로 떴는지 확인하고, 아니면 shift+tab 으로 돌린다 — 아래 절
```

opencode 를 띄울 때의 대응 스위치는 아래 "opencode 를 띄울 때" 절에 있다.

## 내 Bash 로 `claude` 를 직접 띄우지 않는다 — nested 로 잡힌다

Claude Code 는 자기가 낳은 서브프로세스(Bash·PowerShell·Monitor 도구, 훅, 상태줄)에
`CLAUDE_CODE_CHILD_SESSION=1` 을 심는다. **세션 자신에게 붙는 표시가 아니다.** 사람과
대화하는 최상위 세션의 프로세스에는 없고, 그 세션이 낳은 서브프로세스에만 있다(실측).

```sh
$ ps eww -p "$CLAUDE_PID" | tr ' ' '\n' | grep CLAUDE_CODE_CHILD_SESSION   # 세션 프로세스: 없음
$ env | grep CLAUDE_CODE_CHILD_SESSION                                     # 그 세션의 Bash 안: 있음
CLAUDE_CODE_CHILD_SESSION=1
```

문제는 **상속**이다. 내 Bash 에서 `claude` 를 직접 띄우면 그 표시를 물려받은 새 세션이
**nested 로 오분류된다.**
`ssh <host> 'claude ...'`, `setsid nohup claude ...`, `screen`·백그라운드 런처를 거친 실행이
모두 해당한다. nested 로 잡힌 세션은(문서 근거)

- 트랜스크립트가 저장되지 않는다 → 나중에 `claude --resume <id>` 로 못 잇는다
- `--resume`·`--continue`·↑ 히스토리에서 빠진다
- **`claude agents` 등록에서 빠진다** → 주소가 안 생긴다

세 번째가 위임에 치명적이다. 띄웠는데 목록에 안 뜨는 원인이 RC 로그인만은 아니다.

**herdr 를 거치면 이 문제가 없다 — 그 서버가 깨끗한 경우에 한해서.** pane 은 내 환경이 아니라
**herdr 서버의 환경**을 물려받는다. 실측에서 새 pane 은 그 표시가 아예 없었다.

```sh
herdr pane run <pane> 'echo "CCS=[$CLAUDE_CODE_CHILD_SESSION]"'   # 비어 있어야 한다
# CCS=[]
```

**그래서 서버를 내 Bash 로 띄우면 서버째 오염된다.** 그 서버가 낳는 **모든 pane 과 그 안의
모든 claude** 가 nested 로 잡힌다 — 서버 하나가 그 머신의 위임을 통째로, 조용히 망가뜨린다.
**노출은 로컬이다.** ssh 는 환경을 실어 나르지 않으므로 원격은 이 경로로 오염되지 않는다
(실측: `ssh oci-ko 'env | grep -c "^CLAUDE"'` → `0`. 클라이언트 기본 `SendEnv` 는 `LANG LC_*`
뿐이고, 받는 쪽도 `AcceptEnv` 로 허용해야 한다).

그래도 **서버를 띄우는 명령에는 로컬·원격 가리지 않고 항상 붙인다.** 원격에서는 no-op 이고,
로컬에서는 이 함정을 없앤다. 붙는 비용이 없으므로 조건을 따지지 않는다.

```sh
env -u CLAUDE_CODE_CHILD_SESSION -u CLAUDECODE herdr server ...
```

`=0` 이나 빈 문자열로 주지 않는다 — 그 표시가 값으로 판정되는지 존재로 판정되는지 문서가
말하지 않는다. **지우는 것이 유일하게 모호하지 않다.**

서버를 다시 띄울 수 없는 상황이면 pane 쪽에서 덮는다 — 문서가 주는 override 다.

```sh
herdr pane split --current --direction right --cwd <경로> --no-focus \
  --env CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1
```

**이 override 를 서버에 걸지 않는다.** 서버에 걸면 그 아래 전부가 물려받아, pane 안의
claude 가 정말로 낳은 중첩 세션까지 최상위로 잡힌다. 서버는 지우고(`env -u`), 덮는 것은
문제가 확인된 pane 하나로 한정한다.

굳이 Bash 에서 `claude` 를 직접 띄워야 하면 같은 것을 앞에 붙인다.

```sh
CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 claude ...
```

## 권한 모드는 auto — 거는 길이 둘이다

기본 모드로 뜬 세션은 **첫 권한 프롬프트에서 멈춘다.** 읽기 전용 조회 하나에도 멈추고, 그
사이 아무 일도 하지 않는다. 더 나쁜 것은 **그 사실이 위임한 쪽에 안 보인다**는 것이다 —
`SendMessage` 의 `notify_when_idle` 은 blocked 를 알려주지 않는다(아래 "완료를 아는 법").
사람이 화면을 보고 알려줄 때까지 조용히 서 있는다(실측).

**1. 시작 파라미터 (기본).** `--permission-mode auto` 를 `agent start` 의 `--` 뒤에 준다.
유효값은 `acceptEdits` · `auto` · `bypassPermissions` · `manual` · `dontAsk` · `plan` 이다.

**2. 뜬 뒤 전환 (대비).** 파라미터가 안 먹었거나(옛 claude, 값 거부) 이미 떠 있는 세션이면
`shift+tab` 이 모드를 순환시킨다. **순서를 가정하지 말고 상태줄을 읽어 확인한다** — 실측에서
`accept edits → plan → auto` 였지만 그 순서가 보장된다는 근거는 없다.

```sh
for i in 1 2 3 4; do
  m=$(herdr pane read <pane id> --lines 4 | tail -1)
  case "$m" in *"auto mode"*) echo ok; break;; esac
  herdr pane send-keys <pane id> shift+tab >/dev/null; sleep 1
done
```

두 길은 배타가 아니다. 파라미터를 주고도 **떴을 때 상태줄로 확인하는 것이 순서다** — 위
루프는 이미 auto 면 키를 한 번도 안 보내고 끝난다.

**`--settings` 로 주지 않는다.** 권한 모드는 `permissions` 키 안에 있고, `--settings` 는 키
단위로 얹히므로 그 머신 `settings.json` 의 `permissions` 가 통째로 갈린다(위 `tui` 절의 주의).
`--permission-mode` 는 그 세션에만 적용되는 별도 플래그라 설정 파일을 건드리지 않고,
`shift+tab` 도 그 세션의 UI 상태만 바꾼다.

## 띄울 때는 항상 `--settings '{"tui":"default"}'`

풀스크린 렌더러는 alternate screen 에 그리고, 거기서 밀려난 줄은 herdr 의 host scrollback
에 들어가지 않는다. 그러면 `pane read` 로 **현재 화면 이상을 못 읽는다.** 입력은 어느
쪽이든 되지만 읽기가 막히므로 herdr 로 조작할 세션은 기본 렌더러로 띄운다.

- `tui` 유효값은 `"default"`(기본 렌더러)와 `"fullscreen"` 둘뿐이다.
- `--settings` 는 기존 설정을 대체하지 않는다. 우선순위 최상위 소스 한 장을 더 얹을 뿐이라
  그 머신 `settings.json` 의 `env`·`permissions`·`hooks`·`enabledPlugins` 는 그대로 산다.
- 단 키 단위로 얹히므로 `permissions` 같은 객체를 같이 넣으면 그 키는 통째로 갈린다.
  바꿀 키만 넣는다.
- 머신의 `~/.claude/settings.json` 은 건드리지 않는다. 사람이 직접 붙어 쓸 때는 풀스크린이
  낫다. 끄는 건 herdr 로 조작할 세션에 한정한다.

## 프롬프트 제안을 끈다 — `--prompt-suggestions` 로는 안 꺼진다

Claude Code 는 턴이 끝나면 **다음에 사용자가 칠 법한 문장을 입력란에 미리 띄운다.** 사람이
보기엔 흐린 제안이지만 `pane read` 로 뜬 텍스트에는 그 구분이 없다. 그래서 위임한 쪽이
화면을 읽으면 **사람이 실제로 친 입력과 똑같이 보인다.**

실측에서 이것이 두 가지를 동시에 망가뜨렸다.

- 제안 문구(`로그인했어, 이어서 진행해`)를 사용자 입력으로 읽고 "로그인이 끝났다" 고 판정했다.
  브라우저를 실제로 조회하니 로그인 화면 그대로였다
- 그 텍스트가 입력란에 있다고 믿고 보낸 `/exit` 가 그 뒤에 붙어 명령으로 인식되지 않았다.
  세션은 죽지 않았는데 herdr 의 이름 등록만 풀려 `agent list` 가 비었다

**끄는 스위치는 셋이고 `--prompt-suggestions` 는 그중에 없다.** 그 플래그는 print/SDK 모드에서
턴마다 `prompt_suggestion` 메시지를 내보내게 하는 것이라(`-p ... --output-format stream-json`),
대화형 세션에 `false` 로 줘도 **아무 일도 일어나지 않는다.** 대화형의 스위치는 `/config` 토글,
설정 키 `promptSuggestionEnabled`, 환경변수 `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` 셋이고
환경변수가 설정보다 우선한다.

띄울 때 둘 다 건다 — 설정 키는 `--settings` 에, 환경변수는 pane 에.

```sh
herdr pane split --current --direction right --cwd <경로> --no-focus \
  --env CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false
herdr agent start <name> --kind claude --pane <pane id> -- \
  --settings '{"tui":"default","spinnerTipsEnabled":false,"promptSuggestionEnabled":false}' \
  --permission-mode auto
```

pane 에 실은 환경변수는 그 pane 에서 에이전트를 갈아 끼워도 산다(PATH 만은 셸 rc 가 덮는다 —
위 "새 머신" 절).

실측(2026-09-10, claude 2.1.267)으로 갈랐다.

| 띄운 방식 | 긴 턴(12·17초) 뒤 입력란 |
|---|---|
| `--prompt-suggestions false` | `❯ session-delegation SKILL.md 가 475줄인데 좀 쪼개자` — 떴고 다음 턴에도 또 떴다 |
| `--env` + `promptSuggestionEnabled: false` | 두 턴 모두 비어 있음 |

**짧은 턴으로는 대조가 안 된다.** 제안은 프롬프트 캐시가 식었거나 턴이 짧으면 원래 안 뜨고,
플랜 모드·직전 턴 오류·사용량 한도 근처에서도 건너뛴다. 아래 스피너 팁 절과 같은 조건이다.

herdr 로 조작할 세션은 항상 끈다. 사람이 직접 붙어 쓰는 세션에서는 켜 두는 편이 낫다 —
끄는 것은 `--settings '{"tui":"default"}'` 와 같은 이유이고 같은 범위다.

**화면 텍스트로 상대의 상태를 판정하지 않는다.** 끄더라도 원칙은 남는다 — 상대가 무엇을
했는지는 그 결과를 직접 조회해서 본다(브라우저면 브라우저, 파일이면 파일). 화면은 그 다음이다.

## `spinnerTipsEnabled: false` — 스피너 팁도 끈다

작업이 길어지면 스피너 아래에 팁 한 줄이 붙는다.

```
⎿  Tip: Continue your session in Claude Code Desktop with …
```

`pane read` 로는 이것도 그냥 텍스트라 위 `--prompt-suggestions` 절과 같은 오독을 부른다.
`--settings` 의 `tui` 옆에 함께 넣는다.

실측으로 갈랐다 — 같은 pane 에서 같은 작업(스펙 JSON 을 읽고 세는 일, 14초·15초)을 돌리고
설정 하나만 달리했다.

| | 결과 |
|---|---|
| 설정 없음 | `⎿  Tip: Continue your session in Claude Code Desktop with …` |
| `spinnerTipsEnabled: false` | 팁 줄 없음 — 스피너만 |

**팁이 뜨려면 턴이 충분히 길어야 한다.** 1초짜리 작업으로는 대조군에서도 재현되지 않으므로,
이 설정을 검증할 때는 십수 초 걸리는 일을 시켜야 한다.

`~/.claude.json` 의 `tipLifetimeShownCounts` 로 누적 표시 횟수를 볼 수 있으나 전역 카운터라
어느 세션이 늘렸는지 갈리지 않는다 — 판정 근거로 쓰지 않는다.

## opencode 를 띄울 때 — `--mini --auto`

`--kind opencode` 로 띄우는 세션에도 위 세 절과 같은 문제가 있고, 스위치만 다르다.

| 목적 | claude | opencode |
|---|---|---|
| 권한 프롬프트에서 멈추지 않기 | `--permission-mode auto` | `--auto` (명시적으로 deny 한 것 외에는 전부 승인) |
| 기본 렌더러(alternate screen 안 씀) | `--settings '{"tui":"default"}'` | `--mini` |
| 팁·제안 끄기 | `spinnerTipsEnabled`·`promptSuggestionEnabled` | 해당 없음 — 아래 "읽을 때 함정" |
| 모델 지정 | `--model <alias>` | `-m <provider>/<model>` |

```sh
herdr agent start <name> --kind opencode --pane <pane id> -- -m <provider>/<model> --mini --auto
```

실측(2026-09-11, opencode 1.18.25 · herdr 0.9.0)으로 갈랐다.

| 띄운 방식 | 23줄짜리 pane 에서 80줄 출력 뒤 `agent read --lines 200` |
|---|---|
| 기본(풀스크린) | 일하는 중에는 `agent_not_idle` 로 거부 — "alternate-screen history can only be captured by scrolling while idle". idle 이 된 뒤에야 herdr 가 스크롤해서 읽는다 |
| `--mini` | 셸 명령줄부터 80줄 전부 90줄로 읽힘 — host scrollback 에 그대로 남는다 |

권한은 `opencode.json` 의 `permission` 키(`bash`·`edit`·`webfetch` 등을 `ask`/`allow`/`deny`)가
정하고, `--auto` 는 `deny` 가 아닌 것을 전부 승인한다. 실측한 머신(`permission` 키 없음)에서는
`--auto` 유무와 무관하게 bash `date` 가 묻지 않고 통과했다 — 기본값이 이미 `allow` 쪽이다.
그래도 `--auto` 를 준다: `ask` 로 둔 머신에서는 멈추고, 그것이 위임한 쪽에 보이지 않는 것은
claude 와 같다. 멈춘 상태를 herdr 가 `blocked` 로 잡는지는 이번에 멈추는 상황을 만들지 못해
재지 않았다. **`--auto` 를 줬어도 blocked 감시는 따로 건다.**

**읽을 때 함정.** 끌 스위치가 없는 두 가지가 `pane read` 텍스트에 그대로 섞인다.

- 사고 과정이 `Thinking: …` 으로 본문 앞에 찍힌다(thinking 을 켠 모델). 답변으로 읽지 않는다.
- 빈 입력란의 placeholder(`Ask anything... "Fix a TODO in the codebase"`)가 입력처럼 보인다.
  위 `--prompt-suggestions` 절과 같은 오독이므로, 입력란 텍스트로 상태를 판정하지 않는다.
  **끄는 설정이 없다** — 배포본(1.18.25)에 문구 목록이 하드코딩돼 있고(`"Fix a TODO in the
  codebase"`, `"What is the tech stack of this project?"`, `"Fix broken tests"` 중 하나), `tui.json`
  스키마의 `prompt` 키는 `max_width` 뿐이다. 대신 **첫 메시지 전에만 뜬다** — mini 는 코드에서
  `state().first` 가 아니면 빈 문자열을 그리고, 풀스크린도 홈 화면 컴포넌트에만 목록이 넘어간다.
  실측에서 프롬프트를 한 번 보낸 뒤의 `agent read` 에는 이 문구가 없었다. 그러므로 `agent start`
  직후 화면을 읽어 무언가를 판정하지 않으면 섞이지 않는다.

**`agent start` 인자에 `--prompt` 를 넣지 않는다.** claude 와 같은 이유다 — 띄우기와 일 넘기기를
나눈다. 파일을 붙여 보낼 일이면 `opencode run -f <path>` 가 있지만 그것은 대화형 세션이 아니라
단발 실행이고, 대화형 세션에서는 프롬프트 본문에 경로를 적어 읽게 한다.

이미지를 붙일 때는 `opencode.json` 의 `attachment.image` 한도(기본 2000×2000, 초과 시 리사이즈)와
모델 쪽 한도가 따로 있다. 모델이 무엇을 받았는지는 화면이 아니라 응답 내용으로 검증한다.

## 다른 머신에 맡기기

그 세션이 Remote Control 로 떠 있어야 `ListAgents` 에 잡힌다. 기본은 꺼져 있다.

**제어는 ssh 로 간다.** `herdr machine add` 로 머신을 저장해 두어도 **내 pane 에서 도는
`herdr` 명령이 그 머신으로 가지는 않는다** — 상속받은 세션·소켓 컨텍스트를 그대로 쓴다.
machine 은 사람이 한 창에서 여러 머신을 보는 장치(통합 에이전트 목록·머신별 알림·자동
재접속)이고, `herdr machine list` 도 pane 인벤토리가 아니라 접속 프로필 목록이다. ID 와
에이전트 이름은 서버마다 따로 매겨지므로 두 머신에 `w1:p1` 이나 같은 이름의 에이전트가
동시에 있을 수 있다. 원격 제어는 그 호스트에서 명령을 돌리고 ID 를 그쪽에서 다시 찾는다.

```sh
ssh <host> "herdr agent start <name> --kind claude --pane <id> -- \
  --remote-control <name> \
  --settings '{\"tui\":\"default\",\"spinnerTipsEnabled\":false,\"promptSuggestionEnabled\":false}'"
```

`--remote-control` 은 그 세션과 **브리지로 대화할 때만** 필요하다. ssh 로 붙어 herdr 로
부리기만 할 것이면 빼도 된다 — 그러면 claude.ai 로그인도 필요 없다.

도는 세션에도 `/remote-control` 로 나중에 붙일 수 있다. 다만 그렇게 켜면 이름을 못 정해서
호스트명 기반 자동 이름이 붙는다. 이름을 맞추려면 세션을 다시 띄운다.

**RC 는 claude.ai 계정 로그인을 요구한다.** 토큰이 만료돼 있으면 `--remote-control` 을 줘도
등록되지 않고 `ListAgents` 에 안 뜬다. 증상은 화면의 `Not logged in · Run /login`. 이때는
`/login` → "1. Claude account with subscription" → 브라우저 URL 을 **사용자에게 넘겨** 코드를
받아 붙여넣는다. OAuth 는 대신 해줄 수 없다. 로그인한 뒤 세션을 다시 띄워야
`--remote-control <이름>` 이 먹는다.

붙었는지는 상태줄의 `/rc active` 로 확인한다. pane 이 좁으면 잘려 보이니, 본문의
`/remote-control is active` 줄도 같이 본다.

접속 경로가 필요한 작업(웹서버를 띄우고 내가 열어보는 등)이면 **미리 확인한다.**

```sh
ssh <host> 'cd /tmp && python3 -m http.server 8811 --bind 0.0.0.0 & sleep 2'
curl -s --max-time 6 http://<host>:8811/
```

## 버전이 갈릴 때 — 붙기는 붙고 일부만 안 먹는다

0.9 부터 클라이언트를 올려도 호환되는 서버와 그 안에서 돌던 에이전트는 그대로 산다. 대신
**서버에 없는 기능은 그 동작 하나만 죽고 접속은 된다.** 증상이 "연결 실패" 가 아니라 "명령
하나가 조용히 안 먹는다" 로 오므로, 다른 머신에 맡기기 전에 양쪽을 잰다.

```sh
herdr status                  # client/server version, endpoint_compatible
ssh <host> 'herdr status'     # 원격 서버는 따로 잰다
```

endpoint generation 1 보다 오래된 서버는 한 번 올려야 붙는다. 원격이 구버전이면 이 스킬이
기대는 것부터 어긋난다.

| 0.9 에서 고쳐진 것 | 구버전에서 겪는 것 |
|---|---|
| Claude 의 MCP 질문·Bash 승인 대기를 `blocked` 로 유지 | 승인 대기가 blocked 로 안 잡혀 아래 감시가 헛돈다 |
| 터미널 제목이 없을 때도 turn·백그라운드 작업을 인식 | 일하는 중인 pane 이 idle 로 보인다 |
| 아직 화면에서 밀려나지 않은 출력도 `recent` 읽기에 포함 | `pane read` 가 빈 문자열을 준다 — 풀스크린 렌더러 탓이 아니다 |

**버전을 맞추겠다고 원격 서버를 멈추거나 갈아 끼우지 않는다.** 그 머신에서 돌던 남의 pane
프로세스가 함께 죽는다. 0.9 는 원격 서버를 교체하기 전에 묻고 기본 답이 No 다 — 그 기본값을
사용자 동의 없이 넘기지 않는다. 없는 기능은 그 동작만 피해서 간다.

## 세션을 갈아 끼울 때

pane 은 살리고 그 안의 에이전트만 바꾼다.

1. `/remote-control` → "Disconnect this session" (메뉴 커서 기본값은 "Continue")
2. `/exit` — 종료 시 찍히는 `claude --resume <id>` 는 맥락이 필요할 때를 위해 보관한다
3. `herdr agent list` 가 빈 배열인 것을 확인한다. 이름이 남아 있으면 `agent_name_taken` 이 난다
4. 같은 pane 에 새로 띄운다

## 새 머신에 herdr 을 올릴 때

`herdr machine add <ssh-target> --label <이름>` 이 원격 설치를 준비하고 서버까지 띄운 뒤
프로필을 저장한다. 설치가 없거나 비호환이면 대화형 승인을 요구하고(비호환 서버 교체는 기본
No), `claude` 는 여전히 따로 깔아야 한다. 승인 대화를 띄울 수 없는 자리이거나 그 머신을
프로필로 남기지 않을 것이면 손으로 간다.

```sh
curl -sS https://herdr.dev/latest.json          # assets + sha256 맵
ssh <host> 'uname -sm'                          # 클라우드 인스턴스는 aarch64 인 경우가 흔하다
# 받아서 sha256 검증 후 ~/.local/bin/herdr 로 설치, 그다음 헤드리스로 기동
ssh <host> 'env -u CLAUDE_CODE_CHILD_SESSION -u CLAUDECODE \
  setsid nohup ~/.local/bin/herdr server >/tmp/herdr-server.out 2>&1 </dev/null &'   # 항상 지우고 띄운다
```

서버가 뜨면 workspace `w1` 과 pane `w1:p1` 이 셸 프롬프트 상태로 이미 있다. `pane split`
없이 바로 `agent start` 한다.

`claude` 가 없으면 `curl -fsSL https://claude.ai/install.sh | bash` 로 네이티브 설치한다
(node 불필요). 설치 위치는 `~/.local/bin` 이고 **pane 의 셸은 `.bashrc` 만 읽으므로**
우분투 기본값에서는 PATH 에 안 잡힌다. `.bashrc` 에 추가하고, 이미 떠 있는 pane 에는
`pane run` 으로 `export PATH=$HOME/.local/bin:$PATH` 를 한 번 넣는다.

pane 을 만들 때 환경을 실을 수도 있다 — `pane split`·`workspace create`·`tab create` 가
`--env KEY=VALUE` 를 받는다. **PATH 만은 이걸로 못박히지 않는다.** 실측(zsh, `.zshrc` 가
PATH 를 다시 만드는 머신)에서 `--env FOO=bar` 는 그대로 도착했지만 `--env PATH=...` 는
남지 않았다. 셸 rc 가 나중에 실행되기 때문이다. 실었으면 `pane run <pane> 'echo $PATH'` 로
확인하고, 안 남으면 rc 쪽을 고친다.

## 완료를 아는 법

| 상대 | 방법 |
|---|---|
| **내가 띄운 일꾼** (로컬·원격 무관) | 배경으로 `agent prompt --wait`. 정착하면 그 명령이 끝나며 나를 깨운다 — `blocked` 도 깨움이다 |
| 이미 떠 있는 남의 세션 (같은 머신) | `SendMessage` 에 `notify_when_idle: true`. 한 번만 오고 폴링이 아니다. **blocked 는 안 온다** |
| 이미 떠 있는 남의 세션 (다른 머신) | 옵션이 없다. 상대의 회신을 기다린다 |

**폴링하지 않는다.** `ListAgents` 를 반복해 부르거나 "다 됐어?" 를 보내지 않는다.

### 맡기고 턴을 끝낸다 — 배경 wait 가 나를 깨운다

`agent prompt --wait` 를 **포그라운드로 부르면 그 시간 내내 내가 서 있어야 한다.** 20분짜리를
맡기면 20분을 잡는다. 배경으로 돌리면(Bash `run_in_background`) 그 명령이 끝날 때 하네스가
나를 다시 부르므로, 나는 턴을 끝내고 다른 일을 한다.

```sh
herdr agent prompt <name> "<일감>. 결과는 <경로>에 마크다운으로 쓰고 나에게는 경로만 답하라." \
  --wait --timeout 1800000
```

`prompt` 와 `wait` 를 나누지 않는 이유는 아래 절과 같다 — 한 번에 부른다. 깨어나면
**반환된 `agent_status` 를 먼저 본다.**

| 깨어나서 본 것 | 할 일 |
|---|---|
| `idle` · `done` | 약속한 파일을 회수해 검증한다 |
| `blocked` | 무엇을 묻는지 읽고 답한 뒤 **다시 장전한다**(아래) |
| `timeout` · `agent_prompt_stalled` | 그것도 깨움이다. `agent get` 으로 실제 상태부터 본다 |

실측(2026-09-10, herdr 0.9.0 · claude 2.1.267): 12초짜리 일에 배경 `--wait` 를 걸고 턴을
끝냈더니 `exit 0` 과 `"agent_status":"idle"` 로 다시 불려왔다. 이어서 질문을 던지게 시킨
회차에는 `"agent_status":"blocked"` 로 깨어났다. 결과는 화면이 아니라 상대가 쓴 파일에서
회수했다(822바이트, 내용 직접 확인).

### blocked 는 깨어나서 처리한다 — 장전을 빼먹지 않는다

깨어난 상태가 `blocked` 면 **묻는 것을 먼저 읽는다.** 내용을 안 보고 답하지 않는다 — 그
세션이 내 권한 밖의 일을 승인받으려는 것일 수 있다(아래 "권한 세탁 금지").

```sh
herdr agent explain <name>                                    # 어떤 규칙·근거로 blocked 인지
herdr agent read <name> --source recent-unwrapped --lines 40  # 무엇을 묻는지 전문
```

실측에서 `explain` 이 `rule: live_blocked_form` 과 근거
`"Enter to select · ↑/↓ to navigate · Esc to cancel"` 를 줬다. 선택 UI 라는 뜻이므로 답은
키로 넣는다. `agent prompt` 는 blocked 인 에이전트를 `agent_blocked` 로 거부한다.

```sh
herdr agent send-keys <name> down enter   # 커서를 옮겨 고른다 — 커서 위치는 read 로 확인한 뒤
herdr agent send-keys <name> esc          # 취소. 상대는 그 도구가 취소된 것으로 받는다
```

답한 뒤 **배경 wait 를 다시 장전한다.** 이걸 빼먹으면 다음 blocked 를 다시 못 본다.

```sh
herdr agent wait <name> --timeout 1800000   # 배경으로. idle·done·blocked 어디서든 깬다
```

`--until blocked` 로 좁히지 않는다 — 그러면 끝난 것을 못 받는다. 좁히는 것은 "이미 도는
남의 에이전트가 멈추는지만 본다" 처럼 완료가 내 관심사가 아닐 때뿐이다.

`agent_blocked` 거부를 **프롬프트 텍스트를 밀어 넣는 쪽으로 우회하지 않는다.** 그 UI 가
받는 것은 키다. 답을 키로 넣는 것과, 거부당한 프롬프트를 `pane send-text` 로 욱여넣는 것은
다른 일이다.

장전이 **즉시 돌아올 수 있다** — 이미 정착한 상태면 그 자리에서 끝난다. 그건 놓친 것이
아니라 한 번 더 확인하라는 신호다. 상태를 보고, 아직 할 일이 남았으면 다시 건다.

내가 ssh 로 붙어 있는 원격 pane 도 같은 절차다. RC 도 브리지도 필요 없다.

### 내가 못 깨어날 때를 위한 백스톱

`askUserQuestionTimeout` 을 주면 답 없는 `AskUserQuestion` 대화상자가 유휴 시간 뒤 **이미
선택돼 있던 항목으로 스스로 진행한다.** 값은 `"60s"`·`"5m"`·`"10m"`·`"never"` 뿐이고 기본은
`"never"` — 즉 기본은 무한 대기다.

```sh
--settings '{"tui":"default","spinnerTipsEnabled":false,"promptSuggestionEnabled":false,"askUserQuestionTimeout":"10m"}'
```

**깨어나서 답하는 루프를 대신하지 않는다.** 자동 진행은 기본 선택지를 고르는 것이라, 내가
내렸어야 할 판단을 상대가 조용히 정해 버린다. 내 루프가 먼저 이기도록 길게 잡고, 그래도
아무도 안 왔을 때만 도는 안전장치로 쓴다.

**권한 승인 대화상자는 이걸로 안 풀린다.** 이 설정은 `AskUserQuestion` 에만 걸린다 —
승인 프롬프트는 그대로 서 있으므로 auto 모드와 위 감시가 여전히 답이다.

### `notify_when_idle` 은 blocked 를 알려주지 않는다

승인 프롬프트에서 멈춘 세션은 idle 도 아니고 완료도 아니라, 그 알림이 오지 않는다. 위임한
쪽에서 보면 **일하는 중과 구분되지 않는다.** 실측에서 조사를 맡긴 세션이 읽기 전용 명령
하나의 승인 대기로 멈춰 있었는데, 사람이 화면을 보고 알려줄 때까지 몰랐다.

herdr 은 그 상태를 `blocked` 로 분류한다(승인·질문 UI 를 인식한다). **브리지로 맡겼더라도
감시는 herdr 로 따로 건다** — 위 "맡기고 턴을 끝낸다" 의 배경 wait 가 그 자리다.

**auto mode 와 별개로 항상 건다.** auto 는 권한 프롬프트를 줄이는 것이지 없애는 것이 아니다 —
모델이 던지는 질문, 계획 승인, auto 가 자동으로 답하지 않는 종류의 확인은 그대로 남는다.
"auto 로 띄웠으니 안 멈춘다" 고 보고 감시를 빼면, 멈춘 세션을 다시 못 보게 된다.

### `prompt` 와 `wait` 를 나눠 부르지 않는다

```sh
herdr agent prompt <name> "..." --wait --timeout 120000
```

`prompt` 를 보내고 나서 따로 `agent wait` 를 걸면 **그 사이의 전이를 놓친다.** 0.9 부터 새
구독은 지난 이벤트를 재생하지 않고 구독한 시점부터의 라이브 이벤트로 시작하므로, 이미
지나간 상태 변화를 기다리다 타임아웃까지 서 있게 된다. 한 번에 `--wait` 로 간다.

`--wait` 는 제출 뒤 5초 안에 **관측된 `working` 또는 `blocked`** 를 요구한다. 무관한 `idle`
이나 세션 변화는 이 관문을 통과시키지 않는다. 못 보면 `agent_prompt_stalled`, 호출자 타임아웃이
먼저 끝나면 `timeout` 이다.

**둘 다 "전달되지 않았다" 는 증거가 아니다.** 같은 프롬프트를 다시 밀어 넣기 전에 `agent get`
과 `agent read` 로 무엇이 들어갔는지 본다 — 두 번 들어간 지시는 상대가 두 번 한다.

### 상태가 납득이 안 되면 `agent explain`

무엇을 보고 그 상태로 판정했는지 규칙과 근거를 준다. 화면 텍스트를 내가 다시 읽고 추측하는
것보다 이쪽이 먼저다(위 `--prompt-suggestions` 절).

```
$ herdr agent explain <name>
agent: claude
state: working
rule: osc_title_working (region=osc_title priority=1100)
evidence: "◐ Claude Code"
```

`unknown` 은 에이전트가 있는데 분류를 못 한 것이지 완료가 아니다. 어느 신호가 비어 그렇게
됐는지를 이 출력이 가른다.

## 무엇을 재는 위임이면 지시가 답을 흘리지 않는다

절차나 문서가 통하는지 재려고 세션을 띄웠다면, **그 지시문 자체가 재려던 단계를 건너뛰게
만들 수 있다.** 흔한 셋이다.

| 지시에 넣은 것 | 그래서 못 재는 것 |
|---|---|
| 문서·파일의 절대 경로 | 그것을 스스로 찾는 단계 |
| 세션 이름·포트·작업 디렉터리 | 절차가 그 값을 정해 주는지 |
| "먼저 X 절을 보고 진행하라" | 그 경로를 스스로 고르는지 |

자원 이름은 충돌을 막으려고 못박는 것이라 필요할 때가 있다. 다만 **못박는 순간 그 항목은
측정 대상에서 빠진다**는 것을 알고 하고, 회신을 읽을 때 그 부분을 통과로 세지 않는다.

증상도 알려 주되 원인 가설은 주지 않는다. 가설을 주면 그 가설을 확인하러 가지, 관측에서
출발하지 않는다.

## 병렬로 나눌 때

**각자 쓸 자원 이름을 지시에 못박는다.** 같은 시각에 도는 세션들이 같은 이름의 브라우저
세션이나 포트, 파일을 잡으면 서로 망가진다.

- 상대에게 **다른 세션도 같은 일을 하고 있다는 것**과 각자의 이름을 알려준다
- 기존에 돌던 자원은 건드리지 말라고 명시한다
- 결과를 쓸 경로를 지정한다

요청에는 **무엇을, 어디에, 어떤 형태로 회신할지**를 담는다. 판단이 갈릴 지점은 미리
정해준다. 그러지 않으면 상대가 선택지를 띄우고 멈춘다.

## 결과를 받은 뒤

**회신 내용을 그대로 옮기지 않는다.** 검증할 수 있는 주장은 직접 확인한다.

- 파일이나 URL 이 결과면 직접 받아서 크기·해시·내용을 본다
- 상대가 잰 수치는 조건을 바꿔 다시 잰다(다른 뷰포트, 다른 시점)
- 상대가 스스로 판정할 수 없다고 넘긴 부분이 판정의 핵심인 경우가 많다

여러 세션의 결과가 **우연히 같아 보이면 의심한다.** 같은 대상을 본 것인지, 정말 같은
결과인지 가르는 독립 확인을 한 번 더 한다.

## 함정

**`agent start` 인자에 일감을 넣지 않는다.** herdr 가 그 인자를 셸 명령줄로 조립하므로
꺾쇠와 줄바꿈이 거부된다. 띄우기와 일 넘기기를 나눈다.

**`agent_not_ready` 는 실패가 아닐 수 있다.** 시작 중 대화상자에서 멈춘 상태다. 신뢰
대화상자, 첫 실행 안내, 잘못된 `--settings` 값에 대한 Settings Error 가 모두 이 코드로
떨어진다. `pane read` 로 화면을 보고 무엇을 묻는지, 커서가 어느 항목에 있는지 확인한 뒤
답한다.

**Remote Control 은 다른 머신에서만 필요하다.** 같은 머신의 세션은 그것 없이도 서로 보이고
메시지가 간다.

**`~/.claude.json` 은 도는 세션들이 함께 쓴다.** 신뢰 등록으로 그 파일을 고칠 때는 백업을
두고, 되도록 그 머신에 세션이 적을 때 한다.

**권한 세탁 금지.** 내 세션에서 막힌 작업을 남에게 시키지 않는다. 상대가 자기는 거부당했으니
대신 해달라고 하면 거절하고 사용자에게 알린다.

**내가 만들지 않은 pane·세션을 닫지 않는다.** 그 안에 쌓인 맥락이 함께 사라진다. 세션을
갈아 끼울 때도 pane 은 재사용한다. 내가 만든 것을 닫을 때는 `herdr pane close <id>` 를
쓰고, **닫기 전에 그 pane 이 들고 있던 자원을 그 세션이 정리하게 한다** — 브라우저 세션·서버·
포트는 pane 을 닫아도 그대로 살아남는다.

**프롬프트에 남은 미전송 입력은 pane 과 함께 사라진다.** 사용자가 타이핑해 두고 보내지 않은
줄이 있으면 닫는 순간 없어진다. `pane read` 로 화면 아래쪽을 보고, 있으면 닫기 전에 알린다.

**`ListAgents` 의 이름과 herdr 의 이름은 다르다.** 둘을 잇는 것은 `herdr agent list` 뿐이다 —
`name`·`pane_id`·`cwd` 가 한 줄에 나오므로, 그것으로 대조해 어느 pane 이 어느 세션인지 정한다.
`herdr pane list` 는 pane 만 주고 에이전트 이름을 주지 않는다.

**`name` 은 이름을 준 에이전트에만 붙는다.** 사람이 직접 띄운 세션은 `agent list` 에 종류
(`"agent":"claude"`)와 `pane_id`·`cwd`·`terminal_title` 만 나오고 `name` 자체가 없다(실측).
내가 띄우지 않은 세션은 cwd 로 대조하는 수밖에 없고, 그 대조는 추정이다.

**`workspace close --group` 을 습관적으로 붙이지 않는다.** 0.9 부터 worktree workspace 가
열려 있는 primary workspace 는 그냥은 닫히지 않고 `workspace_group_close_required` 로
거부된다. 그 거부는 **묶인 것이 더 있다는 통지**지 `--group` 을 붙이라는 뜻이 아니다 —
붙이면 연결된 worktree workspace 까지 함께 닫힌다.

**`notify_when_idle` 구독은 pane 을 닫은 뒤에도 발화한다.** 이미 정리한 세션의 idle 통지가
뒤늦게 도착하므로, 그 알림을 새 작업 신호로 읽지 않는다.
