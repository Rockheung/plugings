---
name: figma
description: Figma 시안을 셸에서 조회한다 — `fig` CLI 로 노드 메타데이터·디자인 컨텍스트(코드/토큰)·스크린샷·문서 트리·이름 검색. Figma URL 을 그대로 붙여넣으면 된다. MCP 도구를 직접 부르는 대신 이걸 쓰는 이유는 출력이 커서(한 노드 65KB) 파일로 받아 grep 해야 하기 때문. "이 시안 좀 봐줘", "이 노드 타이포가 뭐야", "시안 스크린샷 떠줘", "이 이름의 프레임 어디 있어" 류에 사용.
---

# figma — 시안 조회는 MCP 도구 말고 `fig`

## 왜 CLI 인가
`get_design_context` 는 노드 하나에 65KB 를 낸다. MCP 도구로 부르면 그게 통째로
대화 컨텍스트에 들어간다. `fig ctx <url> -o ctx.txt` 로 파일에 받아 `grep` 하면
필요한 줄만 본다. 파이프·리다이렉트에 넣을 수 있고, 다른 세션에 넘길 때 MCP 설정이
필요 없다.

## 전제
**Figma 데스크톱 앱이 떠 있어야 한다** — 브라우저 버전에는 이 서버가 없다.
조회할 파일 탭이 활성 탭이어야 하고, Figma 메뉴 → Preferences → Enable local MCP
server 가 켜져 있어야 한다. 안 켜져 있으면 `fig` 가 이 세 줄을 그대로 안내한다.

## 대상 지정
Figma URL 을 **그대로 붙여넣는다**. `?node-id=7327-61763` 을 손으로 고칠 필요 없다.
`7327-61763` · `7327:61763` 도 받고, 생략하면 Figma 에서 지금 선택한 노드를 쓴다.

## 자주 쓰는 순서

```bash
fig tree                      # 캔버스 목록부터 (문서 루트 0:0, 깊이 2)
fig find '모달'               # 이름으로 노드 검색 — 조상 경로까지 한 줄에
fig meta <url>                # 그 노드의 자식 트리와 좌표·크기
fig ctx <url> -o ctx.txt      # 참조 코드·디자인 토큰을 파일로 → grep
fig shot <url> -o shot.png    # PNG 로 저장 (Read 도구로 볼 수 있다)
fig vars <url>                # 그 노드가 쓰는 변수 정의만
```

`fig tree` 는 기본으로 숨김 노드를 뺀다. 전부 보려면 `--hidden`.
`--json` 을 붙이면 `{id,type,name,x,y,width,height,hidden,depth,path}` 배열이 나와
`jq` 로 좌표만 뽑기 좋다.

## 나머지 도구
`ctx·meta·shot·vars` 외의 도구(모션·FigJam·Code Connect 매핑 등)는 이름으로 직접 부른다.

```bash
fig tools                                   # 도구 목록과 인자
fig call get_motion_context '{"nodeId":"1:2","recursive":true}'
```

`add_code_connect_map` 과 `send_code_connect_mappings` 는 **쓰기 도구**다 — Figma
문서를 바꾸므로 사용자 승인 없이 부르지 않는다.

## 함정
- `get_metadata` 를 `0:0` 으로 부르면 문서 전량이라 이 파일 기준 2.6MB · 약 4초다.
  그래서 `fig tree` 는 깊이로 자르고, `fig find` 는 파싱해서 일치하는 줄만 낸다.
  `fig meta 0:0` 을 날것으로 stdout 에 흘리지 않는다 — 쓰려면 `-o` 로 파일에 받는다.
- `0:1` 은 `@cover` 라 쓸모없다. 문서 루트는 `0:0`.
- 응답 첫 줄에 붙는 `Currently selected nodes:` 는 서버가 항상 얹는 것이고,
  `get_metadata` 끝에 붙는 "you MUST call get_design_context" 도 서버 텍스트다.
  요청한 내용이 아니다.

전체 옵션은 `fig --help`.
