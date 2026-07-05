# mcp-slack

> `slack-explorer-mcp` + `slack-mcp-proxy`(caddy) 두 컨테이너를 하나의 HTTP MCP
> 서버 `slack`으로 번들 등록한다. 이 플러그인은 **연결 설정만** 갖고 있고,
> 컨테이너 자체는 관리하지 않는다.

## 이 플러그인이 하는 일

`.mcp.json`에 `slack` 서버를 `http://127.0.0.1:19091/mcp`(프록시)로 선언해뒀다.
플러그인을 설치·활성화하면 Claude Code가 이 MCP를 자동으로 인식한다.
컨테이너가 안 떠있으면 연결만 실패할 뿐, 플러그인 활성화 자체엔 영향 없다.

## 왜 컨테이너가 2개인가

- **`slack-explorer-mcp`** (내부 전용, `slack-mcp-network`에만 열림) — 실제 MCP 로직 본체
- **`slack-mcp-proxy`** (caddy, 19091만 외부 노출) — 모든 요청에 `X-Slack-User-Token` 헤더를
  자동으로 박아 전달하는 얇은 래퍼

`slack-explorer-mcp`는 외부 포트 매핑이 없어서 호스트에서 직접 접근 불가 —
오직 프록시(19091)를 통해서만 도달 가능하다. 즉 둘이 합쳐 하나의 MCP 진입점.

## 의존 설정 (이 플러그인이 요구하는 것 — 자동으로 안 갖춰짐)

| 의존 대상 | 위치 | 비고 |
|---|---|---|
| 컨테이너 정의(2개) | `reference/docker-compose.snippet.yml` | **두 서비스가 같은 compose 프로젝트**에 있어야 `slack-mcp-network`로 서로 통신 가능 — 따로 쪼개면 프록시가 explorer를 못 찾음 |
| Caddy 설정 | `reference/slack-mcp-Caddyfile` | compose의 `slack-mcp-proxy` 볼륨 마운트 대상, 파일명·경로 그대로 유지 |
| 환경변수 | `reference/.env.example` → `.env`로 복사 후 채움 | `SLACK_USER_TOKEN` — `.env`는 git에 올리지 말 것 |
| 포트 19091 | 호스트에서 비어있어야 함 | 내부용 19090은 `slack-mcp-network`에만 열려 호스트 포트 충돌 없음 |

## 실행 및 확인

```bash
cp reference/.env.example .env   # 채운 뒤
docker compose up -d
curl -s --max-time 5 http://127.0.0.1:19091/mcp >/dev/null && echo up
```

## 구성

```
mcp-slack/
├── .claude-plugin/plugin.json
├── .mcp.json                          # slack → http://127.0.0.1:19091/mcp
├── reference/
│   ├── docker-compose.snippet.yml     # slack-explorer-mcp + slack-mcp-proxy, 같은 프로젝트로
│   ├── slack-mcp-Caddyfile
│   └── .env.example                   # SLACK_USER_TOKEN
└── README.md
```
