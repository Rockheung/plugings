# config-map

> Claude Code 설정을 **경로 상속(cascade)까지 해소**해 하나의 인터랙티브 인스펙터로 시각화한다.
> `~/.claude` 를 base 로 두고, 각 경로가 그 위에 얹는 설정을 델타로 계산 —
> DevTools 의 computed-styles 처럼 **"이 경로에서 실제 활성인 설정"** 을 origin 배지와 함께 보여준다.

핵심 철학: **추측 금지, 실측만.** 데이터는 LLM 기억이 아니라 `collect.sh` 의 읽기전용 스캔에서 온다.

![layers](https://img.shields.io/badge/base%20%E2%86%92%20path%20delta-cascade-blue) ![readonly](https://img.shields.io/badge/scan-read--only-green)

---

## 무엇을 보여주나

**왼쪽 — 경로 트리.** `★ ~/.claude`(base)를 뿌리로, 설정을 가진 경로들을 실측해 나열.
각 노드에 배지(`S` settings · `C` CLAUDE.md · `M` MCP)와 델타 유무를 표시. "델타 있는 경로만" 필터.

**오른쪽 — 선택 경로의 유효 설정:**

| 섹션 | 내용 |
|---|---|
| **해소 순서 스택** | managed › 프로젝트 local › 프로젝트 settings › 유저 base — 존재하는 레이어만 강조 |
| **델타** | 이 경로가 base 에 ＋더한 / −끈 것 (플러그인·MCP·훅·CLAUDE.md·로컬 컴포넌트) |
| **유효 설정** | 런타임·권한·플러그인·MCP·훅을 base(⤵ 상속) + 델타(＋/−)로 병합 |
| **CLAUDE.md 체인** | 루트→cwd 누적 상속을 순서대로 |

## 쓰는 법

```
내 Claude 설정 시각화해줘
```

또는 스킬 직접 호출. `collect.sh` 가 스캔 → 인스펙터 Artifact 로 발행된다.

## 해소 규칙

```
managed  >  프로젝트 .claude/settings.local.json  >  프로젝트 .claude/settings.json  >  유저 base(~/.claude)
```

CLAUDE.md 는 덮어쓰기가 아니라 **루트→cwd 로 누적** 상속. 경로 발견은
`~/.claude.json` 의 projects(Claude 가 실제 돈 cwd) + 파일시스템의 `.claude/settings*.json` 를 합쳐 실측.

## 마스킹 계약

공개 플러그인으로서 민감값은 **스크립트 단에서** 방출하지 않는다:

- `env` — 키 이름만 (값 ✗)
- MCP url — `?` 이후 쿼리 제거, stdio args 의 `key=/token=/secret=` 마스킹
- CLAUDE.md / 메모리 — 경로·줄수만 (내용 ✗)
- 로그인/크레덴셜 — 스캔 대상 아님

## 의존성

- `jq` (`brew install jq`) — 없으면 안내 후 중단
- 대상 경로는 `CLAUDE_CONFIG_DIR` 로 override (기본 `~/.claude`)

## 구성

```
config-map/
├── .claude-plugin/plugin.json
├── skills/config-map/
│   ├── SKILL.md          # 절차 + 마스킹 계약 + 렌더 규약
│   ├── collect.sh        # 읽기전용 스캔 → { base, nodes } JSON (마스킹)
│   └── template.html     # cascade 인스펙터 (라이트/다크, DATA 주입)
└── README.md
```

`collect.sh` 는 데이터, `template.html` 은 디자인, SKILL 은 둘을 엮어 발행한다 —
스타일·렌더는 결정적(템플릿), 데이터는 실측, 값 주입만 모델이 한다.
