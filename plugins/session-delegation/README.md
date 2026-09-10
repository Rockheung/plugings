# session-delegation

> 다른 세션은 **부하가 아니라 주소를 가진 동료**다.
> 맡기는 절차보다 **주소를 확정하는 절차**와 **회신을 검증하는 절차**가 더 자주 틀린다.

![address](https://img.shields.io/badge/address-ListAgents%20name-blue) ![tui](https://img.shields.io/badge/tui-default%20required-orange) ![polling](https://img.shields.io/badge/polling-forbidden-red)

---

## 세 갈래

| 상황 | 준비 | 방법 |
|---|---|---|
| **이미 떠 있는 세션** | 없음 | `ListAgents` 로 고르고 `SendMessage` → **턴을 끝낸다.** 회신은 `<cross-session-message>` 로 온다 |
| **새 세션을 띄운다** | herdr pane | `pane split` → `agent start ... -- --remote-control <name> --settings '{"tui":"default"}'` |
| **다른 머신** | 그쪽에 Remote Control | 같은 명령을 `ssh <host>` 로. RC 가 없으면 `ListAgents` 에 안 잡힌다 |

## 주소가 흔들리는 지점

**이름은 관측자마다 다르다.** 같은 세션이 자기 머신에서는 작업 디렉토리 기반 이름으로,
다른 머신에서는 호스트명 접두사나 대화 제목으로 보인다. 한쪽에서 본 이름을 다른 쪽에
알려주며 "그 세션에 보내라"고 하면 상대는 찾지 못한다.

| 같은 세션을 | 자기 머신에서 | 다른 머신에서 |
|---|---|---|
| 예 | `rock-fb` | `mini-lcl-snoopy-hellman` |
| 예 | `heungjun-ed` | `Herdr 클라이언트 다중 서버 오케스트레이션` |

해법 둘:

- 내가 띄우는 세션이면 **`--remote-control <이름>`** 으로 못박는다. 그 이름이 그대로 목록에 뜬다
- 한 번 주고받은 상대는 회신의 **`from` 값**(`bridge:session_...`)으로 기억한다. 이름이 바뀌어도 유효하다

`ListAgents` 에는 **머신 이름 컬럼이 없다.** 어느 세션이 어느 머신인지는 이름에서 추정할
뿐이다. 확실히 알아야 하면 그 세션에 직접 물어본다.

## 왜 `--settings '{"tui":"default"}'` 인가

풀스크린 렌더러는 alternate screen 에 그린다. 거기서 위로 밀려난 줄은 herdr 의 host
scrollback 에 **들어가지 않는다.** `pane read --lines 300` 을 줘도 현재 화면 이상은 못
되살린다. 입력(`send-text`·`send-keys`·`agent prompt`)은 멀쩡한데 읽기만 막히므로,
증상이 "조작은 되는데 결과를 못 본다" 로 나타난다.

```sh
herdr agent start <name> --kind claude --pane <pane> -- \
  --remote-control <name> --settings '{"tui":"default"}'
```

- `tui` 유효값은 `"default"` 와 `"fullscreen"` 둘뿐
- `--settings` 는 **덮어쓰지 않는다.** 우선순위 최상위 소스 한 장을 더 얹을 뿐이라 그 머신
  `settings.json` 의 `env`·`permissions`·`hooks`·`enabledPlugins` 는 그대로 산다
- 단 **키 단위로 얹힌다.** `permissions` 같은 객체를 같이 넣으면 그 키는 통째로 갈린다
- 머신 설정은 건드리지 않는다. 사람이 직접 붙어 쓸 땐 풀스크린이 낫다

## 폴링 금지

| 대상 | 완료를 아는 법 |
|---|---|
| 같은 머신 | `SendMessage` 의 `notify_when_idle: true` — 한 번만 오고 폴링이 아니다 |
| 다른 머신 | 이 옵션이 없다. 상대의 회신을 기다린다 |
| 내가 ssh 로 붙어 있는 pane | `herdr agent prompt <name> "..." --wait` 후 `pane read` |

`ListAgents` 를 반복해 부르거나 "다 됐어?" 를 보내지 않는다.

**`notify_when_idle` 은 blocked 를 알려주지 않는다.** 승인 프롬프트에서 멈춘 세션은 idle 도
완료도 아니라 알림이 오지 않고, 위임한 쪽에서는 일하는 중과 구분되지 않는다. 그래서
`herdr agent wait <name> --until blocked` 를 **항상 병행한다.**

권한 모드는 `--permission-mode auto` 로 띄우고(안 먹었으면 `shift+tab` 순환), 그것과 **별개로**
위 감시를 건다. auto 는 프롬프트를 줄이는 것이지 없애는 것이 아니다.

## 회신을 받은 뒤

**그대로 옮기지 않는다.** 검증할 수 있는 주장은 직접 확인한다 — 파일·URL 은 받아서 크기와
내용을 보고, 상대가 잰 수치는 조건을 바꿔 다시 잰다. 상대가 "스스로 판정할 수 없다"고
넘긴 부분이 판정의 핵심인 경우가 많다. 여러 세션의 결과가 **우연히 같아 보이면 의심한다.**

## 함정

- **`agent start` 인자에 일감을 넣지 않는다** — herdr 가 셸 명령줄로 조립하므로 꺾쇠·줄바꿈이 거부된다. 띄우기와 일 넘기기를 나눈다
- **`agent_not_ready` 는 실패가 아닐 수 있다** — 신뢰 대화상자, 첫 실행 안내, 잘못된 `--settings` 값이 모두 이 코드다. `pane read` 로 화면을 보고 답한다
- **RC 는 claude.ai 로그인을 요구한다** — 토큰이 만료면 조용히 등록되지 않는다. 증상은 `Not logged in · Run /login`. OAuth 는 대신 해줄 수 없으므로 URL 을 사람에게 넘긴다
- **`herdr machine` 은 CLI 를 리타게팅하지 않는다** — 머신을 저장해도 내 pane 의 `herdr` 명령은 로컬 서버로 간다. 원격 제어는 계속 `ssh <host> 'herdr ...'` 이고 ID·이름은 서버마다 별개다
- **버전이 갈리면 붙기는 붙는다** — 0.9 부터 서버에 없는 기능만 죽고 접속은 되므로 "명령 하나가 조용히 안 먹는" 모양으로 온다. 맡기기 전에 양쪽 `herdr status`. 맞추겠다고 원격 서버를 멈추지 않는다
- **권한 세탁 금지** — 내 세션에서 막힌 작업을 남에게 시키지 않는다
- **내가 만들지 않은 pane·세션을 닫지 않는다** — 세션을 갈아 끼울 때도 pane 은 재사용한다

## 설치

```
/plugin marketplace add Rockheung/plugings
/plugin install session-delegation@plugings
```
