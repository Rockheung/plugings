---
name: session-delegation
description: |
  다른 Claude 세션에 일을 맡기고 결과를 받을 때 읽는다. 같은 머신의 세션, 새로 띄우는
  세션, 다른 머신(원격 서버)의 세션이 각각 절차가 다르다.
  ListAgents 나 SendMessage 를 부르기 전에, 그리고 herdr 로 pane 을 만들어 에이전트를
  띄우기 전에 읽는다.
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
herdr workspace create --cwd <경로> --label <짧은 이름>   # 반환된 workspace 에 pane 이 하나 선다
herdr pane list --workspace <id>                          # 그 pane id 로 agent start
```

workspace label 은 그 경로를 알아보게 짓는다(기존 것들이 `foyer`·`veilcast` 처럼 디렉터리
이름을 쓴다). 화면이 바뀌므로 사용자가 보고 있는 작업을 가리지 않는지는 만들기 전에 생각한다.

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
herdr pane split --current --direction right --cwd <경로> --no-focus

# 2. 에이전트를 띄운다. 인자에 일감을 넣지 않는다
herdr agent start <name> --kind claude --pane <pane id> -- \
  --remote-control <name> --settings '{"tui":"default","spinnerTipsEnabled":false}' \
  --permission-mode auto --prompt-suggestions false

# 3. 실제로 auto 로 떴는지 확인하고, 아니면 shift+tab 으로 돌린다 — 아래 절
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

## `--prompt-suggestions false` — 화면을 읽어 판단한다면 끈다

Claude Code 는 턴이 끝나면 **다음에 사용자가 칠 법한 문장을 입력란에 미리 띄운다.** 사람이
보기엔 흐린 제안이지만 `pane read` 로 뜬 텍스트에는 그 구분이 없다. 그래서 위임한 쪽이
화면을 읽으면 **사람이 실제로 친 입력과 똑같이 보인다.**

실측에서 이것이 두 가지를 동시에 망가뜨렸다.

- 제안 문구(`로그인했어, 이어서 진행해`)를 사용자 입력으로 읽고 "로그인이 끝났다" 고 판정했다.
  브라우저를 실제로 조회하니 로그인 화면 그대로였다
- 그 텍스트가 입력란에 있다고 믿고 보낸 `/exit` 가 그 뒤에 붙어 명령으로 인식되지 않았다.
  세션은 죽지 않았는데 herdr 의 이름 등록만 풀려 `agent list` 가 비었다

```sh
--prompt-suggestions false   # 값은 true|false|1|0|yes|no|on|off
```

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

## 다른 머신에 맡기기

그 세션이 Remote Control 로 떠 있어야 `ListAgents` 에 잡힌다. 기본은 꺼져 있다.

```sh
ssh <host> "herdr agent start <name> --kind claude --pane <id> -- \
  --remote-control <name> --settings '{\"tui\":\"default\",\"spinnerTipsEnabled\":false}' --prompt-suggestions false"
```

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

## 세션을 갈아 끼울 때

pane 은 살리고 그 안의 에이전트만 바꾼다.

1. `/remote-control` → "Disconnect this session" (메뉴 커서 기본값은 "Continue")
2. `/exit` — 종료 시 찍히는 `claude --resume <id>` 는 맥락이 필요할 때를 위해 보관한다
3. `herdr agent list` 가 빈 배열인 것을 확인한다. 이름이 남아 있으면 `agent_name_taken` 이 난다
4. 같은 pane 에 새로 띄운다

## 새 머신에 herdr 을 올릴 때

```sh
curl -sS https://herdr.dev/latest.json          # assets + sha256 맵
ssh <host> 'uname -sm'                          # 클라우드 인스턴스는 aarch64 인 경우가 흔하다
# 받아서 sha256 검증 후 ~/.local/bin/herdr 로 설치, 그다음 헤드리스로 기동
ssh <host> 'setsid nohup ~/.local/bin/herdr server >/tmp/herdr-server.out 2>&1 </dev/null &'
```

서버가 뜨면 workspace `w1` 과 pane `w1:p1` 이 셸 프롬프트 상태로 이미 있다. `pane split`
없이 바로 `agent start` 한다.

`claude` 가 없으면 `curl -fsSL https://claude.ai/install.sh | bash` 로 네이티브 설치한다
(node 불필요). 설치 위치는 `~/.local/bin` 이고 **pane 의 셸은 `.bashrc` 만 읽으므로**
우분투 기본값에서는 PATH 에 안 잡힌다. `.bashrc` 에 추가하고, 이미 떠 있는 pane 에는
`pane run` 으로 `export PATH=$HOME/.local/bin:$PATH` 를 한 번 넣는다.

## 완료를 아는 법

| 대상 | 방법 |
|---|---|
| 같은 머신 | `SendMessage` 에 `notify_when_idle: true`. 한 번만 오고 폴링이 아니다 |
| 다른 머신 | 이 옵션이 없다. 상대의 회신을 기다린다 |

**폴링하지 않는다.** `ListAgents` 를 반복해 부르거나 "다 됐어?" 를 보내지 않는다.

내가 ssh 로 붙어 있는 원격 pane 이면 `herdr agent prompt <name> "..." --wait` 로 동기적으로
시키고 `pane read` 로 읽는 방법도 있다.

### `notify_when_idle` 은 blocked 를 알려주지 않는다

승인 프롬프트에서 멈춘 세션은 idle 도 아니고 완료도 아니라, 그 알림이 오지 않는다. 위임한
쪽에서 보면 **일하는 중과 구분되지 않는다.** 실측에서 조사를 맡긴 세션이 읽기 전용 명령
하나의 승인 대기로 멈춰 있었는데, 사람이 화면을 보고 알려줄 때까지 몰랐다.

herdr 은 그 상태를 `blocked` 로 분류하니(승인·질문 UI 를 인식한다) 감시는 herdr 로 건다.
`SendMessage` 경로를 쓰더라도 이건 따로 걸어야 한다.

```sh
herdr agent wait <name> --until blocked --timeout 120000
```

**auto mode 와 별개로 항상 건다.** auto 는 권한 프롬프트를 줄이는 것이지 없애는 것이 아니다 —
모델이 던지는 질문, 계획 승인, auto 가 자동으로 답하지 않는 종류의 확인은 그대로 남는다.
"auto 로 띄웠으니 안 멈춘다" 고 보고 감시를 빼면, 멈춘 세션을 다시 못 보게 된다.

- `blocked` 로 돌아오면 `agent read` 로 **무엇을 묻는지 먼저 본다.** 내용을 안 보고 답을
  보내지 않는다 — 그 세션이 내 권한 밖의 일을 승인받으려는 것일 수 있다(아래 "권한 세탁 금지")
- `agent prompt` 는 blocked 인 에이전트에 입력을 보내지 않고 `agent_blocked` 로 거부한다.
  그 거부를 우회해 `pane send-keys` 로 눌러 넘기지 않는다

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

**`notify_when_idle` 구독은 pane 을 닫은 뒤에도 발화한다.** 이미 정리한 세션의 idle 통지가
뒤늦게 도착하므로, 그 알림을 새 작업 신호로 읽지 않는다.
