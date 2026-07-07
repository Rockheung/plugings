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

## 철학

**추측 금지, 실측만.** 설정을 LLM 기억으로 짐작하지 않고, 읽기전용 스크립트가
실제 파일을 스캔한 값만 렌더한다. 민감값(토큰·env 값·파일 내용)은 스캔 단계에서 마스킹한다.

## 라이선스

MIT
