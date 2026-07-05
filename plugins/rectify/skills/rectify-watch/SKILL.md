---
name: rectify-watch
description: |
  세션 transcript 를 라이브로 tail 하며 CLAUDE.md 규칙(오라클) 위반을 즉시
  조기경보한다. Magistrate 의 사후(post-mortem) 증거 심리에 대응하는 *실시간*
  예방 모드 — 비가역·outward 행위(push/merge/삭제/외부전송) 직전 정황을 우선 경보.

  사용 시점:
  - 다른 세션/현재 세션을 감시하며 CLAUDE.md 규칙 위반을 실시간으로 잡고 싶을 때
  - 비가역 행위 직전 confirm-gate 류 예방경보가 필요할 때
---

세션을 **라이브로 감시하며 CLAUDE.md 규칙 위반을 즉시 잡는다** — Magistrate 의 사후(post-mortem) 심리에 대응하는 *실시간* 모드.

세션 jsonl transcript 를 tail 하며, 흘러오는 user/assistant 이벤트마다 **규칙 오라클(CLAUDE.md)에 비춰** 위반/의심을 surface 한다. 이 스킬은 *감사(audit) 렌즈*가 CLAUDE.md 규칙으로 고정된 전용 감시 — tail·렌즈·종료까지 자립적으로 수행한다.

$ARGUMENTS: 감시 대상. `<cwd-or-encoded-path> [<session-id>]`. 비우면 가장 최근 세션 자동 발견.

## 절차

1. **오라클 로드**: governing CLAUDE.md(user-global + 대상 세션 cwd→상위)를 읽어 규칙 카테고리를 도출(하드코딩 X).

2. **세션 stream tail** (Claude Code 세션 jsonl 규약):
   - 세션 파일: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (`encoded-cwd` = 경로의 `/`→`-`). 미지정이면 `ls -t .../*.jsonl | head -1`.
   - **Monitor tool**(persistent)로 tail:
     ```bash
     tail -F <session.jsonl> 2>/dev/null \
       | jq -r --unbuffered '
           select(.type=="user" or .type=="assistant")
           | ( .message.content | if type=="string" then . else [.[]?|select(.type=="text")|.text]|join(" ") end ) as $t
           | select(($t // "" | length) > 0)
           | "[\(.type|ascii_upcase)] " + ($t[:400] | gsub("[\n\r]"; " "))'
     ```
   - (sub-agent 까지: `<session>/subagents/*.jsonl` 을 `tail -F -q`.)
   - **함정**: multi-file `tail -F` 는 `==> file <==` header 를 뱉어 jq parse 실패 → `-q` 필수. user/assistant text 만 + 400자 cap 으로 출력 폭주 방지. 새 sub-agent 파일은 monitor 시작 시 glob 고정이라 못 잡음(재시작 필요).

3. **이벤트마다 audit 렌즈**: 도착한 행위가 규칙 카테고리와 충돌하는 정황이면 **즉시 플래그**:
   - `⚠️ [의심 위반] <행위> — <어긴 규칙> — <근거>` 를 사용자에게 알린다.
   - 라이브는 transcript text 만 보이므로 **확정이 아니라 조기경보**. 확정 심리는 Magistrate(증거 기반)에게.
   - 특히 비가역·outward 행위(push/merge/삭제/외부 전송) 직전 정황을 우선 경보.

4. **종료/요약**: 감시 중단 시, 플래그한 의심 목록을 넘겨 **Magistrate 로 사후 확정 심리**를 이어가도록 제안.

## 경계
- 라이브 감사는 **예방·조기경보**(confirm-gate 류), 사후 확정은 **Magistrate**(증거·분리 critic). 둘은 보완.
- 라이브는 transcript text 만 보이므로 **확정이 아니라 조기경보** — 확정 심리는 증거 기반 Magistrate 에게.
- 다른 사용자 머신의 세션 X — 본인 `~/.claude` 만.
