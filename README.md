# plugings

> [Claude Code](https://claude.com/claude-code) 플러그인 마켓플레이스 — by [Rockheung](https://github.com/Rockheung).

## 설치

```
/plugin marketplace add Rockheung/plugings
/plugin install config-map@plugings
```

## 플러그인

| 플러그인 | 설명 |
|---|---|
| **[config-map](./plugins/config-map)** | Claude Code 설정을 **경로 상속(cascade)까지 해소**해 인터랙티브 지형도로 시각화. `~/.claude`(base) 위에 각 경로가 얹는 델타(플러그인·MCP·훅·CLAUDE.md)를 실측해, 경로를 고르면 그 지점의 유효 설정을 origin 배지로 보여준다. DevTools computed-styles 형 인스펙터. 민감값 마스킹. |

## 철학

**추측 금지, 실측만.** 설정을 LLM 기억으로 짐작하지 않고, 읽기전용 스크립트가
실제 파일을 스캔한 값만 렌더한다. 민감값(토큰·env 값·파일 내용)은 스캔 단계에서 마스킹한다.

## 라이선스

MIT
