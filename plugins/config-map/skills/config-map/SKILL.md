---
name: config-map
description: |
  Claude Code 설정을 경로 상속(cascade)까지 해소해 인터랙티브 지형도(Artifact)로
  시각화한다. ~/.claude 를 base 로 두고, 각 경로가 그 위에 얹는 설정
  (플러그인 활성/비활성·프로젝트 MCP·훅·CLAUDE.md·로컬 agent/skill/command)을
  델타로 계산해, "이 경로에서 실제 활성인 설정"을 origin 배지(base 상속 / 여기 추가 /
  여기 비활성)와 함께 보여준다. DevTools 의 computed-styles 인스펙터와 같은 구조.

  데이터는 추측이 아니라 collect.sh 의 읽기전용 실측 스캔에서 온다.

  사용 시점:
  - "내 Claude 설정 시각화 / 설정 지도 / config map / 어느 경로에서 뭐가 켜지나"
  - 프로젝트별 설정이 base 를 어떻게 덮는지(플러그인·MCP·훅·CLAUDE.md) 한눈에 볼 때
  - 팀원/다른 머신 설정을 점검·문서화할 때
---

Claude Code 설정을 **경로 상속까지 해소해서** 하나의 인터랙티브 인스펙터(Artifact)로 만든다.

핵심 원칙: **데이터는 스크립트가 실측하고, 렌더만 네가 한다.** 설정값·경로·델타를
기억이나 추측으로 채우지 말 것 — 반드시 `collect.sh` 출력 JSON 을 유일한 소스로 삼는다.

## 모델 (먼저 이해)

- **base** = `~/.claude` 전역 설정. 모든 세션·경로의 출발점.
- **경로 델타** = 특정 디렉토리에서 실행할 때 base 위에 얹히는 것. 해소 우선순위(위가 이김):
  `managed > 프로젝트 .claude/settings.local.json > 프로젝트 .claude/settings.json > 유저 base`.
  CLAUDE.md 는 덮어쓰기가 아니라 **루트→cwd 로 누적** 상속된다.
- 대부분 경로는 델타가 없어 base 를 그대로 쓴다(pass-through). 지도의 가치는 **델타가 있는 소수 경로**를 도드라지게 하는 것.

## 절차

1. **스캔 실행** — 스킬 디렉토리의 collect.sh 를 bash 로 돌려 JSON 을 받는다:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/skills/config-map/collect.sh"
   ```

   (`CLAUDE_PLUGIN_ROOT` 없으면 이 SKILL.md 옆의 collect.sh.) 대상은 기본 `~/.claude`,
   `CLAUDE_CONFIG_DIR` 로 override. `jq` 없으면 `{"error":"jq_not_found"}` 반환 →
   사용자에게 `brew install jq` 안내 후 멈춘다. 스캔은 홈 트리를 훑어 수 초 걸릴 수 있다.

   출력 형태:
   ```json
   { "base": {model,effort,theme,tui,envKeys,allow,deny,plugins,mcp,hooks,claudemd},
     "nodes": [ {path,depth,kind,files,add:{plugins,mcp,hooks,local,claudemd},off:{mcp}} ],
     "meta": {projectCount,resolution} }
   ```
   `kind` = `base|delta|thin|passthru`. `add`=이 경로가 더한 것, `off.mcp`=이 경로가 끈 MCP.

2. **렌더** — 같은 디렉토리의 `template.html` 을 **디자인 시스템으로 그대로 재사용**한다:
   - `<style>` 블록과 렌더 `<script>` 로직은 **통째로 유지**한다. 색·레이아웃을 새로 짜지 말 것.
   - 스크립트 안의 `var DATA = /* CONFIG_MAP_DATA */ { …샘플… };` **한 줄 할당만**
     collect.sh 가 뱉은 JSON 으로 교체한다:
     `var DATA = /* CONFIG_MAP_DATA */ <붙여넣은 JSON>;`
     나머지 렌더 코드는 이 DATA 형태를 그대로 소비하도록 이미 짜여 있다.
   - 그 외 마크업/JS 를 손대지 말 것. (샘플 데이터를 실데이터로 갈아끼우는 것이 유일한 편집.)

3. **발행** — Artifact 로 발행한다. favicon 은 🗺️, 제목은 "Claude 설정 상속 인스펙터"
   로 안정 유지(재발행 시 같은 파일 경로 → 같은 URL 업데이트). 사용자에게 URL 과 함께
   요지를 3~4줄로 보고한다: 스캔한 경로 수, 델타 있는 경로 수, 눈에 띄는 오버라이드
   (예: 어느 경로가 플러그인을 켜고/MCP 를 끄고/훅을 더하는지).

## 마스킹 계약 (어기지 말 것)

collect.sh 는 이미 아래를 방출하지 않는다 — 렌더에서도 되살리지 말 것:
- env **값** (키 이름만) · MCP url 쿼리스트링·stdio 토큰 · 메모리/CLAUDE.md **내용**(경로·줄수만)
- 로그인/크레덴셜 파일은 스캔 대상이 아니다.

사용자가 명시적으로 값을 요구하지 않는 한, 지도에는 마스킹된 형태만 싣는다.

## 이식성

- 경로는 `CLAUDE_CONFIG_DIR` 우선(기본 `~/.claude`).
- 경로 0개·델타 0개인 최소 설정에서도 깨지지 않는다(트리에 base 뿌리만, 나머지 pass-through).
- 홈에서 실행하면 base 를 그대로 쓰므로 `~` 는 pass-through 로 표시된다(정상).
