---
name: monitor-session
description: |
  특정 Claude Code 세션 또는 그 안의 sub-agent transcript 를 실시간 stream
  으로 모니터링한다. Monitor tool 의 tail -F + jq filter 패턴. user /
  assistant text 라인 마다 notification. session id 또는 cwd 명시,
  optional sub-agent id 명시. optional 로 **바라보는 목적(렌즈)** 주입 가능 —
  주면 그 목적에 비춰 관련 라인을 골라 flag, 안 주면 순수 stream(목적-중립
  primitive).

  사용 시점:
  - 다른 세션의 진행 실시간 추적 (예: 사용자가 두 번째 Claude 창에서 작업
    중이고 이 세션에서 그 진행 감청)
  - sub-agent 의 결정 / 함정 실시간 발견 (이 세션에서 활성 sub-agent 의
    내부 추적)
  - 자동화 흐름 (예: sapman 또는 다른 agent) 의 함정 패턴 감지
  - **목적을 주입해** 특정 렌즈로 감시 (예: "규칙 위반 조짐", "비가역 명령
    직전", "특정 파일 건드림") — 그 목적에 부합하는 라인만 surface
---

# /lens:monitor-session

Claude Code 세션의 jsonl transcript 를 Monitor tool 로 tail. 라인 마다
notification 도착.

**요구 바이너리**: `jq`(필수 — 없으면 stream 즉시 실패, `command -v jq` 로 확인),
`tail`·`ls`(coreutils, 상존), `fswatch`(선택 — 새 sub-agent 파일 감지). 자세히는
plugin README 의 Requirements.

## 세션 파일 위치 (Claude Code 표준)

```
main session:
  ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl

sub-agent transcripts:
  ~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl
  + agent-<id>.meta.json  (agentType, description, toolUseId)
```

`<encoded-cwd>` = 디렉토리 경로의 `/` 를 `-` 로 치환 (예: `/Users/heungjun/f`
→ `-Users-heungjun-f`).

## 호출 패턴

### 1. 명시 세션 (사용자가 session id 또는 cwd 알려줌)

```
/lens:monitor-session <cwd-or-encoded-path> [<session-id>] [--subagent-only] [--for "<무엇을 주시하나>"]
```

### 2. 자동 발견 (가장 최근 mtime)

```
ls -lt ~/.claude/projects/<encoded-cwd>/*.jsonl | head -1   # active session
ls -lt ~/.claude/projects/<encoded-cwd>/<session>/subagents/*.jsonl  # active sub-agents
```

### 3. Monitor tool 호출 (실제 stream 시작)

**main session:**
```bash
tail -F <session.jsonl> 2>/dev/null \
  | jq -r --unbuffered '
      select(.type=="user" or .type=="assistant")
      | ( .message.content
          | if type=="string" then .
            else [.[]? | select(.type=="text") | .text] | join(" ")
            end
        ) as $t
      | select(($t // "" | length) > 0)
      | "[\(.type|ascii_upcase)] " + ($t[:400] | gsub("[\n\r]"; " "))
    ' 2>&1
```

**sub-agents (multi file)** — `tail -F -q` (quiet, header 차단 필수):
```bash
tail -F -q <session>/subagents/*.jsonl 2>/dev/null \
  | jq -r --unbuffered '
      select(.type=="user" or .type=="assistant")
      | ( .message.content
          | if type=="string" then .
            else [.[]? | select(.type=="text") | .text] | join(" ")
            end
        ) as $t
      | select(($t // "" | length) > 0)
      | "[\(.type|ascii_upcase)] " + ($t[:400] | gsub("[\n\r]"; " "))
    ' 2>&1
```

Monitor tool 옵션:
- `persistent: true` — 세션 lifetime (TaskStop 또는 세션 종료 시까지)
- `timeout_ms: 3600000` (= 1h) — persistent 면 무시
- `description: "<cwd> session — user/assistant stream"`

## 목적 주입 (옵션) — 렌즈 얹기

monitor-session 은 기본적으로 **목적-중립 primitive**다: tail 이 흘려보내는
user/assistant 라인을 그대로 surface 할 뿐, "무엇을 위해 보는지"는 비어 있다.
`--for "<텍스트>"` 를 주면 그 빈자리에 **렌즈**를 끼운다.

- **주입 없음(기본)**: 모든 user/assistant 라인을 그대로 stream. (순수 관찰.)
- **주입 있음**: 흘러오는 라인마다 그 목적에 비춰 평가 —
  - 목적과 충돌/부합하는 라인을 **`⚠️ <목적 관련성> — <근거>`** 로 골라 알림.
  - 무관한 라인은 흘려보냄(noise 억제). 비가역·outward 행위(push/merge/삭제/
    외부전송) 정황이면 우선 surface.
  - 렌즈는 **jq 필터가 아니라 모델이 적용하는 의미 판정**이다 — tail|jq 는
    동일하게 raw 라인을 뽑고, 그 위에서 목적에 따라 취사선택한다.

이 메커니즘으로 "감시 + 목적"을 한 도구에서 조합한다. 목적이 고정된 전용
감사가 필요하면, 호출자가 자기 도메인 규칙을 `--for` 로 넣거나 자체 스킬로
감싸면 된다 — monitor-session 자신은 어떤 특정 도메인도 모른다.

## 함정

- **`tail -F` multi-file → `==> file <==` header**: jq parse 실패 + monitor
  exit 5. `-q` 옵션 필수.
- **새 sub-agent 파일 생성 시 못 잡음**: glob 평가는 monitor 시작 시점
  fixed. 새 파일은 monitor 재시작 필요. 또는 sub-agent 디렉토리 자체를
  inotify (macOS = fswatch).
- **jq error (.message.content 없는 type)**: tool_use / tool_result 같은
  type 은 .message.content 가 다른 구조. select 로 user/assistant 만.
- **출력 폭주 시 monitor 자동 정지**: jq filter 가 너무 broad 하면 라인
  수 폭주. user/assistant text 만 + 400자 cap 권장.
- **다른 세션 = 다른 권한**: 사용자 본인의 ~/.claude 만 접근. 다른 사용자
  머신의 세션 X.

## 도구 정리 (참고)

- TaskStop — 진행 중 monitor 중단
- Monitor 의 persistent vs timeout_ms — long-running 은 persistent

## 의도된 사용

사용자 발화 예:
- "~/f 세션 모니터링해" → cwd = ~/f 의 가장 최근 .jsonl tail
- "session abc-123 의 sub-agent 들 추적" → 그 session 의 subagents/*.jsonl
- "지금 활성 sapman 의 결정 실시간으로" → cwd 추론 + sub-agent jsonl
