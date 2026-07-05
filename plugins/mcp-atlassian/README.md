# mcp-atlassian

> 로컬 Docker 컨테이너(`ghcr.io/sooperset/mcp-atlassian`)를 HTTP MCP 서버 `atlassian`으로
> 번들 등록한다. 이 플러그인은 **연결 설정만** 갖고 있고, 컨테이너 자체는 관리하지 않는다.

## 이 플러그인이 하는 일

`.mcp.json`에 `atlassian` 서버를 `http://127.0.0.1:19100/mcp`로 선언해뒀다. 플러그인을
설치·활성화하면 Claude Code가 이 MCP를 자동으로 인식한다. **컨테이너가 안 떠있으면
연결만 실패**할 뿐, 플러그인 활성화 자체엔 영향 없다.

## 의존 설정 (이 플러그인이 요구하는 것 — 자동으로 안 갖춰짐)

| 의존 대상 | 위치 | 비고 |
|---|---|---|
| 컨테이너 정의 | `reference/docker-compose.snippet.yml` | `~/mcps/docker-compose.yml`(또는 원하는 compose 프로젝트)에 병합 |
| 환경변수 | `reference/.env.example` → `.env`로 복사 후 채움 | `JIRA_URL`, `JIRA_USERNAME`, `JIRA_API_TOKEN` — `.env`는 git에 올리지 말 것 |
| Jira API 토큰 | https://id.atlassian.com/manage-profile/security/api-tokens | DEMO 접근 권한 있는 계정으로 발급 |
| 포트 19100 | 호스트에서 비어있어야 함 | 다른 서비스와 충돌 시 `.mcp.json`과 compose 양쪽의 포트를 같이 바꿔야 함 |

## 실행 및 확인

```bash
cp reference/.env.example .env   # 채운 뒤
docker compose up -d
curl -s --max-time 5 http://127.0.0.1:19100/mcp >/dev/null && echo up
```

## 스코프 우선순위 참고

같은 이름(`atlassian`)의 MCP가 유저/프로젝트 스코프(`claude mcp add`)에 별도로 있으면
그쪽이 이 플러그인의 `.mcp.json`보다 우선한다. 즉 이 플러그인은 "기본값"이고,
필요하면 `claude mcp add -s user atlassian <다른 URL>`로 언제든 오버라이드 가능.

## 구성

```
mcp-atlassian/
├── .claude-plugin/plugin.json
├── .mcp.json                          # atlassian → http://127.0.0.1:19100/mcp
├── reference/
│   ├── docker-compose.snippet.yml
│   └── .env.example                   # JIRA_URL · JIRA_USERNAME · JIRA_API_TOKEN
└── README.md
```
