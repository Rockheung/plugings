# lens

> Claude Code 세션을 들여다보는 **범용 렌즈**. 세션 jsonl transcript 를 실시간으로
> stream 하고, 원하면 *바라보는 목적*을 렌즈로 끼워 관련 라인만 골라낸다.

## 스킬

### `/lens:monitor-session`

특정 세션 또는 그 안의 sub-agent transcript 를 `Monitor` 의 `tail -F` + `jq` 로
실시간 stream. user/assistant 라인마다 notification.

```
/lens:monitor-session <cwd-or-encoded-path> [<session-id>] [--subagent-only] [--for "<무엇을 주시하나>"]
```

- 인자: 감시 대상은 **세션이 cwd 로 물고 있는 파일시스템 경로**(또는 encoded-path).
  비우면 가장 최근 세션 자동 발견.
- **`--for "<목적>"`** (옵션): 그 목적(렌즈)에 비춰 관련 라인만 surface. 없으면 순수
  stream(목적-중립 primitive). 렌즈는 jq 필터가 아니라 모델이 적용하는 의미 판정이다.

사용 예:

```
/lens:monitor-session ~/work                              # 순수 stream
/lens:monitor-session ~/work --for "규칙 위반 조짐"        # 그 렌즈로 flag
/lens:monitor-session ~/work --for "비가역 명령 직전"      # confirm-gate 류 예방경보
```

## 요구 바이너리 (Requirements)

monitor-session 은 셸에서 다음 외부 도구를 호출한다. plugin.json 에는 시스템
바이너리 의존성 전용 필드가 없으므로 여기에 명시한다.

| 바이너리 | 필수 | 용도 | 설치 |
|---|---|---|---|
| `jq` | **필수** | jsonl 라인 파싱·필터 | `brew install jq` |
| `tail` | 필수 | transcript stream (`tail -F`) | coreutils — macOS/Linux 기본 상존 |
| `ls` | 필수 | 최근 세션 자동 발견 | coreutils — 기본 상존 |
| `fswatch` | 선택 | 새로 생성되는 sub-agent 파일 감지(macOS inotify 대체) | `brew install fswatch` |

`jq` 만 별도 설치가 필요할 수 있다(`command -v jq` 로 확인). 없으면 stream 이
바로 실패하므로 사용 전 확인 권장.

## 설치

```
/plugin marketplace add Rockheung/plugings
/plugin install lens@plugings
```
