# figma-cli REST 읽기 경로 설계안

상태: 결정 반영본(2026-11-22). 구현하지 않았다. 구현 전에 "실측 계획" 4회를 마친다.

## 목적과 범위

- 목적: Figma MCP 읽기 호출 상한(일 200회, 분당 10~20회 규모)에 걸리는 **구조 읽기**(`index`·`find`·`tree`)의 호출 비용을 REST API 로 옮겨 줄인다.
- 대상 명령: `index`, `find`, `tree`, (선택) `shot`.
- 대상이 아닌 명령: `ctx`, `vars`, 현재 선택 노드를 쓰는 모든 호출. 이유는 아래 "확인된 사실" 의 REST 한계다.
- MCP 경로는 없애지 않는다. REST 는 토큰이 있을 때 구조 읽기에만 쓰는 추가 경로다.

## 확인된 사실

공식 문서 원문 대조(2026-11-22). 문서는 "Figma may change rate limits at any time" 이라고 밝힌다.

호출 제한 (`developers.figma.com/docs/rest-api/rate-limits/`)
- 분당 leaky bucket 이 기본이다. 한도는 사용자의 시트 종류, 엔드포인트 Tier, 리소스가 있는 팀의 플랜으로 정해진다.
- Tier 1: `GET /v1/files/:key`, `GET /v1/files/:key/nodes`, `GET /v1/images/:key` (scope `file_content:read`). Tier 3: `GET /v1/files/:key/meta` (scope `file_metadata:read`).
- Dev·Full 시트: Tier 1 분당 10·15·20, Tier 3 분당 50·100·150. 표에 값이 3개뿐이라 플랜 대응은 원문에 없다(Professional·Organization·Enterprise 순으로 추정). View·Collab 시트는 Tier 1 월 20회.
- 일일 상한은 문서에 없다. 429 응답에 `Retry-After`, `X-Figma-Plan-Tier`, `X-Figma-Rate-Limit-Type`, `X-Figma-Upgrade-Link` 헤더가 있다. 호출 수를 확인하는 방법은 문서에 없다.
- 이 한도가 MCP 호출 상한과 합산인지 별도인지는 문서에 없다.

응답 구조 (`.../file-endpoints/`, `.../file-node-types/`)
- `GET /v1/files/:key` 쿼리: `ids`, `depth`(1 은 페이지만, 2 는 페이지와 최상위 객체), `geometry`, `plugin_data`, `branch_data`, `version`. 응답 최상위: `name`, `lastModified`, `version`, `editorType`, `thumbnailUrl`, `document`, `components`(노드 id → 컴포넌트 메타), `componentSets`, `styles`.
- `GET /v1/files/:key/nodes`: `ids` 필수, `depth`, `geometry`. 응답의 `nodes` 값은 null 일 수 있다.
- `GET /v1/files/:key/meta`: `file.version`, `file.last_touched_at`, `file.name`, `file.editorType`.
- 공통 노드 속성: `id`, `name`, `type`, `visible`(기본 true, false 가 숨김), `boundVariables`. 좌표는 `absoluteBoundingBox`(절대 좌표). `relativeTransform`·`size` 는 `geometry=paths` 일 때만 온다.
- TEXT 노드는 `characters` 를 가진다. INSTANCE 노드는 `componentId`·`componentProperties` 를 가지고, 응답의 `components` 맵으로 인스턴스의 원본 컴포넌트를 알 수 있다.
- `GET /v1/images/:key`: `ids` 필수, `scale`(0.01~4), `format`(jpg·png·svg·pdf). 응답 `images` 는 노드 id → URL 이고 값이 null 이면 렌더 실패다. URL 은 30일 뒤 만료된다.
- 큰 파일에 대한 문서의 수단은 `depth` 와 `ids` 뿐이다. 응답 크기·타임아웃·`ids` 개수 상한은 문서에 없다.
- 현재 선택 노드나 활성 파일을 얻는 REST 엔드포인트는 문서에 없다. 모든 호출이 `fileKey` 를 받는다. `fileKey` 는 `https://www.figma.com/:file_type/:file_key/:file_name` 형식의 URL 에서 얻는다.
- 변수 읽기(`GET local variables`)는 Tier 2 이고 scope `file_variables:read` 는 Enterprise 전용이다.

이 환경
- 사용자 시트는 Dev 다(본인 발언과 사내 Slack 2025-07 시트 현황). 플랜은 Organization 으로 추정한다(2023-08 업그레이드 글, 2025 갱신 글의 시트 단가).
- 파일이 있는 팀의 플랜은 확인하지 못했다. 문서상 다른 플랜의 파일에는 그 플랜의 한도가 적용된다.
- 이전에 만든 `figma-cache-mcp` 의 `remote-api.ts` 가 `X-Figma-Token` 헤더로 같은 엔드포인트를 호출했다. 토큰은 환경변수 `FIGMA_TOKEN` 으로 받았다. 그 토큰의 만료·scope 는 확인하지 못했다.
- 사내 비밀값 보관은 `secret-get`·`secret-list` 이고 저장 명령은 없다(`~/.secrets/<이름>.gpg`).

## 설계

### 1. 명령별 경로

| 명령 | 지금(MCP) | REST 경로 | 비고 |
|---|---|---|---|
| `index` | `get_metadata` 문서 전체 1회 | `GET /v1/files/:key` (Tier 1) | URL 또는 `fileKey` 가 필수 인자가 된다 |
| 색인 신선도 확인 | 마지막 노드 `get_metadata` 1회 | `GET /v1/files/:key/meta` (Tier 3) 의 `version` 비교 | TTL 없이 정확한 확인이 가능한지 실측이 필요하다 |
| `find`·`tree` | `--index` 또는 서버 전체 읽기 | `--index` 만(색인에서 읽는다) | 서버를 부르지 않거나 Tier 3 1회 |
| `shot` | `get_screenshot` | `GET /v1/images/:key` 후 반환된 URL 을 내려받는다 | 선택 사항 |
| `ctx`, `vars`, 선택 노드 | MCP | 대상 아님 | REST 에 코드 생성·선택이 없고 변수 scope 가 Enterprise 전용 |

### 2. 색인 형식

- 노드 형식은 지금과 같은 필드를 유지한다: `id, type, name, x, y, width, height, hidden, depth, path`. REST 응답의 `visible`(반전)·`absoluteBoundingBox` 를 이 필드로 옮기고, 부모 순서로 `depth`·`path` 를 만든다.
- 추가 필드: TEXT 의 `characters`(이름과 다를 때만), INSTANCE 의 `componentId` 와 원본 컴포넌트 이름. 이 둘로 "인스턴스가 어느 컴포넌트인가" 질의가 가능해진다(MCP 색인에는 이 연결 정보가 없다).
- 메타: `source`(`rest`), `fileKey`, `version`, `lastModified`, `builtAt`, `count`.
- 저장: 파일 키별 파일(`index-<fileKey>.json.gz`). 색인 안의 노드는 위 필드만 남기고 나머지 REST 속성은 버려 크기를 줄인다.
- 규모가 10배(노드 수·문서 수)일 때: 저장은 문서당 노드 수에 선형이고 문서 수에 선형이다(정리 정책이 필요하다). 적재는 문서 하나당 노드 수에 선형이다. 조회는 색인 한 개를 읽은 뒤 선형 스캔이라 노드 수에 선형이다. 갱신은 문서 전체를 다시 받아 만드는 것이라 노드 수에 선형이고 Tier 1 호출 1회다. 문서 변경 때마다 전체를 다시 만드는 구조이고 증분 갱신은 하지 않는다.

### 3. 인증과 비밀값

- 토큰은 `X-Figma-Token` 헤더로만 보낸다. scope 는 `file_content:read`, `file_metadata:read`.
- 읽는 순서: 환경변수 `FIGMA_TOKEN`, 없으면 `${XDG_CONFIG_HOME:-~/.config}/fig/token` 파일. 코드·저장소·테스트 픽스처·로그·stderr·오류 메시지에 토큰 값을 넣지 않는다.
- 403 이면 토큰이 무효거나 만료된 것으로 보고 한국어로 안내한다(값은 출력하지 않는다).
- 저장: 설정 경로 `${XDG_CONFIG_HOME:-~/.config}/fig/token` 에 base64 로 인코딩해 둔다. 폴더 권한 `0700`, 파일 권한 `0600`. base64 는 인코딩일 뿐 암호화가 아니므로 실제 보호는 파일 권한이다. 이 맥에서 같은 사용자로 도는 프로세스는 읽을 수 있다.
- `slt` 의 저장 방식(Secure Enclave 로 봉인한 `vault.sealed`, 메뉴바 앱의 소켓으로만 접근, Touch ID 로 열기)은 따르지 않는다. `slt` 명령은 저장한 값을 꺼내는 명령이 없고(계정 비밀번호는 출력하지 않는다) 네이티브 앱이 필요해서 `fig` 가 읽을 방법이 없다.
- 토큰은 사용자가 클립보드에 넣어 주면 에이전트가 파일로 옮기고 값은 출력하지 않는다.

### 4. 호출 예산과 속도 제어

- 호출은 한 프로세스에서 직렬로 보낸다. 동시 호출을 하지 않는다.
- 429 이면 `Retry-After` 를 읽는다. 대기가 15초 이하이면 기다렸다가 한 번 재시도하고, 넘으면 중단하고 `X-Figma-Plan-Tier`·`X-Figma-Rate-Limit-Type` 값과 대기 시간을 안내한다. 이 헤더로 사용자의 플랜·시트를 확인할 수 있다.
- 15초는 측정한 값이 아니라 대기 상한의 관례값(기본 15초, 도달하면 판정하고 연장하지 않는다)이다.
- `figma-cache-mcp` 의 토큰 버킷 구현은 쓰지 않는다. 직렬 호출과 `Retry-After` 존중만으로 요구를 만족한다.
- 일일 상한은 문서에 없으므로 호출 수를 세어 두지 않는다. 문서가 호출 수 확인 수단을 제공하지 않기 때문이다.

### 5. 큰 파일

- 전체 `GET /v1/files/:key` 는 인덱싱 수단이 될 수 없다. `[DM] Widget Studio` 는 응답이 301MB(213,986노드)이고 93초가 걸렸다("실측 결과" 절). 기본 대기 상한 15초의 6배이고 JSON 한 덩어리가 메모리에 올라간다.
- 문서가 제공하는 분할 수단은 `depth` 와 `ids` 다. `depth=2` 는 177KB·4.6초였다. 색인에 필요한 깊이를 정해 페이지별(`ids`)로 요청하는 방식으로 가고, 깊이별 응답 크기를 실측해 정한다. 분할하면 Tier 1 호출이 페이지 수만큼 늘어난다.

### 6. 명령 표면

- `fig index <URL|fileKey>`: REST 색인을 만든다. 토큰이 없으면 지금처럼 MCP 로 만든다.
- `fig find|tree … --index`: 가장 최근에 만든 색인을 쓴다. 파일을 명시하려면 `--file <URL|fileKey>`.
- `--index` 의 신선도 확인: REST 색인이면 `meta` 의 `version` 을 비교한다. MCP 색인이면 지금의 5분 규칙을 유지한다.
- `--type` 어휘: 소문자 REST 타입(`frame`, `text`, `instance`, `component`, `rectangle` …)으로 통일한다. MCP 색인의 `symbol`·`rounded-rectangle` 같은 어휘는 REST 색인에서 쓰지 않는다.

## 확인되지 않은 것

- 토큰의 유효성·scope·만료.
- 이 파일이 있는 팀의 플랜과 실제 분당 한도.
- 전체 `GET file` 의 응답 크기와 소요 시간.
- `meta` 의 `version` 이 편집(자동 저장)마다 바뀌는지, 신선도 확인에 쓸 수 있는지.
- MCP 색인의 `symbol`·`rounded-rectangle`·`variable` 타입과 REST 의 `COMPONENT`·`RECTANGLE` 등의 대응. MCP 문서 트리에 있는 `variable`·`variable-set` 노드는 REST 문서 트리에 없을 것으로 예상하지만 확인하지 않았다.
- MCP 호출 상한과 REST 한도의 합산 여부.

## 실측 계획 (호출 예산 4회)

호출 사이를 10초 두고 직렬로 보낸다(분당 한도 추정 상한 15회의 호출 간격 4초에 두 배 넘는 여유를 둔 관례값). 모든 응답은 저장해 두었다가 오프라인 테스트의 픽스처로 쓴다. 토큰 값은 응답·로그에 남지 않게 한다.

1~3번은 `[DM] Widget Studio` 파일(`fileKey` `ZsugR6FJKIGjbKBv7DLdiZ`, 저장소의 테스트 고정 입력과 같은 파일)에 쓴다. 이 파일은 읽기만 한다.

1. `GET /v1/files/:key/meta` 1회(Tier 3): 토큰·scope·파일 접근을 확인하고 `version`·`last_touched_at` 값을 기록한다.
2. `GET /v1/files/:key?depth=2` 1회(Tier 1): 페이지 목록과 응답 크기를 확인한다.
3. `GET /v1/files/:key` 전체 1회(Tier 1): 크기·소요 시간·필드를 확인하고, 이미 저장된 MCP 색인(`~/.cache/fig/index.xml.gz`)과 노드 id·이름을 대조한다.
4. 사용자가 Figma 에서 개인 Drafts 파일 하나를 편집(노드 하나 이동 후 되돌리기)한 뒤 그 파일에 `GET /v1/files/:key/meta` 를 편집 전·후 각 1회(호출 2회, Tier 3): `version` 이 바뀌는지 확인한다. 공용 파일은 편집하지 않는다.

성공 기준
- 1번에서 200 이고 `version` 을 얻는다. 403 이면 토큰 문제로 중단한다.
- 3번의 REST 노드 중 FRAME·TEXT·INSTANCE·COMPONENT 의 id·이름이 MCP 색인과 일치하는 비율과 불일치 사례를 목록으로 남긴다.
- 4번에서 편집 전후 `version` 이 달라진다. 같으면 신선도 확인에 `version` 을 쓰지 않는다.

## 실측 결과 (2026-11-22, `[DM] Widget Studio`)

호출 4회(401 응답 1회 포함, 이후 새 토큰으로 3회). 응답 헤더에 호출 제한 관련 값은 없었다(`x-figma-rest-api-request-id` 만).

| 호출 | 결과 |
|---|---|
| 기존 토큰으로 `meta` | 401 `{"status":401,"err":"Invalid token"}` (토큰 만료) |
| `GET /v1/files/:key/meta` (Tier 3) | 200, 1.2초, 958B. `file` 키: `name`, `folder_name`, `last_touched_at`, `creator`, `last_touched_by`, `thumbnail_url`, `editorType`, `version`, `link_access`, `url`, `role`. `role` 은 `viewer`, `link_access` 는 `org_view` |
| `GET /v1/files/:key?depth=2` (Tier 1) | 200, 4.6초, 177,131B. 페이지 13개, 최상위 객체 163개(FRAME 48, INSTANCE 47, SECTION 46, TEXT 11, GROUP 3, RECTANGLE 6, VECTOR 2). `version` 이 `meta` 와 같다 |
| `GET /v1/files/:key` 전체 (Tier 1) | 200, 93.1초, 300,915,468B |
| `?depth=3` (Tier 1) | 200, 13.6초, 761,864B, 노드 765개 |
| `?depth=4` (Tier 1) | 200, 25.7초, 3,502,054B, 노드 2,951개 |
| `?depth=2` 다시 (Tier 1) | 200, 0.95초, 177,131B (처음 4.6초) |
| `GET /v1/files/:key/nodes?ids=1:21&depth=3` (Tier 1) | 200, 4.8초, 1,394,034B, 노드 1,330개(최상위 객체가 가장 많은 페이지). 응답 최상위 키에 `nodes`·`version` |

응답 시간은 크기에 비례하지 않는다. 같은 `depth=2` 가 처음 4.6초, 다시 0.95초였고, 3.5MB(`depth=4`)가 25.7초, 301MB(전체)가 93.1초였다. 반복 호출이 빨라지는 것은 서버 쪽 캐시로 보이지만 확인하지 못했다. `depth=3`(765노드)도 처음 호출은 13.6초라 기본 대기 상한 15초에 가깝다.

전체 응답의 구성
- 노드 213,986개, 최대 깊이 26. INSTANCE 66,432, FRAME 45,661, VECTOR 42,938, TEXT 38,340, RECTANGLE 8,008, GROUP 5,321, ELLIPSE 5,009, BOOLEAN_OPERATION 1,007, SLOT 759, SECTION 248, COMPONENT 169, LINE 50, COMPONENT_SET 29, CANVAS 13.
- `visible: false` 노드 29,615개(13.8%).
- TEXT 38,340개 모두 `characters` 가 있다. INSTANCE 66,432개 모두 `componentId` 가 있다. 응답 최상위 `components` 맵 1,046개, `componentSets` 310개, `styles` 77개.
- 페이지 13개 중 `---` 구분 페이지가 3개이고 `@cover` 가 있다.

MCP 색인과의 대조는 성립하지 않았다. 대조에 쓴 MCP 색인(`~/.cache/fig/index.xml.gz`, 16,790노드)은 이 파일이 아니라 Figma 에서 활성이던 다른 파일에서 만든 것이다. 페이지 이름이 겹치지 않고(MCP: `🟢 Design`, `Critique`, `Design QA`, `ref`, `Cover` 등) 노드 id 도 최상위 document 하나만 겹쳤다. 그래서 REST 와 MCP 의 노드 범위(인스턴스 내부, 벡터)와 타입 대응 차이는 아직 알 수 없다.

시사점
- 전체 읽기는 인덱싱 수단이 아니다. 깊이를 제한하면 `depth=4` 에서도 노드 2,951개(전체의 1.4%)이고 TEXT 는 90개(전체 38,340개 중)라서, 문구를 파일 전체에서 찾는 색인은 REST 로 만들 수 없다. 깊은 노드를 얻으려면 `ids` 로 하위 트리를 더 받아야 하고 그 합은 전체 읽기에 가까워진다.
- REST 는 특정 노드 몇 개의 상세(`characters`, `componentId`, 속성)를 필요할 때 받는 용도에 맞는다.
- 인스턴스의 원본 컴포넌트 연결(`componentId` + `components` 맵)은 이 파일에서 전 인스턴스에 있다.
- `meta` 의 `version` 은 편집마다 바뀌지 않는다(아래 "신선도 표지 실측"). 편집 여부는 `last_touched_at` 으로 알 수 있다.

## 신선도 표지 실측 (개인 파일 `Apple Design Resources - macOS (Community)`, `meta` Tier 3)

| 시점 | `version` | `last_touched_at` |
|---|---|---|
| 편집 전(12:51) | `2424451018982409341` | `2026-11-22T03:50:01.801Z` |
| 노드 복제 후(13:23 호출, 편집 12:54경) | `2424451018982409341` | `2026-11-22T03:54:07.758Z` |
| 편집 없이 10초 뒤(13:24) | `2424451018982409341` | `2026-11-22T03:54:07.758Z` |

- `version` 은 편집 후에도 그대로였다. 파일 버전 기록의 한 지점을 가리키는 값으로 보이지만 확인하지 못했다.
- `last_touched_at` 은 편집 후 바뀌었고 편집이 없으면 그대로였다(밀리초 단위). `[DM] Widget Studio` 에서는 `meta` 의 `last_touched_at` 과 `GET file` 의 `lastModified` 가 같은 초였다.
- 확인하지 못한 것: 편집 직후 `last_touched_at` 이 갱신되기까지의 지연(이번 호출은 편집 29분 뒤였다), 다른 사용자의 편집·댓글·보기가 `last_touched_at` 을 바꾸는지, 이 값이 파일을 연 것만으로 바뀌는지(이 파일은 계속 열려 있었는데 바뀌지 않았다).

## 이어지는 실측 계획

1. (완료) 깊이 3·4 실측. 위 표.
2. (완료) 신선도 표지 실측. 위 표.
3. 같은 파일 대조(MCP 와 REST 의 노드 범위 차이): MCP 읽기 호출 상한이 풀린 뒤에 한다.
4. 편집 직후 `last_touched_at` 갱신 지연: 편집 직후 호출을 반복해 갱신까지의 시간을 잰다.

## 결정 (2026-11-22)

1. 색인 소스: REST 색인을 MCP 색인과 같은 형식으로 쓰고 `source` 로만 구분한다.
2. `--type` 어휘: 소문자 REST 타입으로 통일한다.
3. 토큰 보관: `${XDG_CONFIG_HOME:-~/.config}/fig/token`(base64, 파일 `0600`·폴더 `0700`).
4. 429 대기 상한: 15초(관례값).
5. 범위: 구조 읽기(`index`·`find`·`tree`)만. `shot` 의 REST 경로는 넣지 않는다.
6. 실측 파일: 1~3번은 `[DM] Widget Studio`, 4번은 사용자의 개인 Drafts 파일.

## 구현 전에 남은 입력

- 사용자가 토큰을 클립보드에 넣는다(2026-11-22 확인 시점에 클립보드가 비어 있었다).
- 4번에 쓸 개인 Drafts 파일의 URL 과, 그 파일을 편집했다는 알림.
