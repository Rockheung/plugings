---
name: php-lsp-workspace
description: PHP LSP(intelephense, php-lsp-proxy 경유)의 워크스페이스를 확인·전환한다. git worktree 에서 PHP 작업을 시작할 때, 정의 점프/심볼이 다른 체크아웃 경로로 해석될 때, 또는 LSP 인덱싱이 안 도는 것 같을 때 사용.
---

# PHP LSP 워크스페이스 확인·전환 (php-lsp-proxy)

**v0.3+ 는 멀티플렉서다 — LSP 도구 호출의 filePath 가 곧 워크스페이스 선택이다.**
요청 uri 의 git toplevel(마커 존재 시)별로 intelephense 인스턴스를 lazy spawn 해 라우팅하므로,
**원하는 트리(워크트리 포함)의 파일 경로로 LSP 도구를 호출하기만 하면 그 트리가 자동 인덱싱·응답**한다
— 설정 수정/서버 kill/reload 전부 불필요. `workspace/symbol` 처럼 uri 없는 질의는 살아있는 전
인스턴스에 fan-out 후 병합(새 트리를 fan-out 에 넣으려면 그 트리 파일로 documentSymbol 등을 한 번
호출해 인스턴스를 먼저 띄운다). 하네스가 didOpen 을 생략해도 프록시가 디스크에서 합성한다.
동시 인스턴스는 `maxServers`(기본 3, default 제외 LRU 종료)로 제한.

**default 인스턴스**(uri 없는 질의 + 마커 없는 파일 담당)의 워크스페이스 우선순위:

1. **argv** — `--workspace <path>` / `--workspace=<path>` / 첫 positional 경로. plugin.json 의
   `lspServers.intelephense.args` 에 추가해 워크스페이스를 **고정(pin)** 할 때 사용
   (예: `["<script>", "--workspace=/abs/path"]`). plugin.json 수정이므로 반영엔 `/reload-plugins` 필요 —
   정적 pin 용도이고, 수시 전환은 아래 config 경로가 여전히 낫다.
2. env `PHP_LSP_WORKSPACE`
3. autoDetect: 세션 cwd 의 `git rev-parse --show-toplevel` — 단 toplevel 에 마커
   (`composer.json`/`index.php`/`html` 중 하나)가 있을 때만. **PHP 레포/워크트리에서 세션을 열면 자동으로 그 트리.**
4. `~/.config/php-lsp-proxy/config.json` 의 `defaultWorkspace`

## 현재 워크스페이스 확인

- 최신 로그: `ls -t ~/.config/php-lsp-proxy/logs/ | head -1` → 그 파일의 `workspace:` / `initialize 재작성` 라인.
- 또는 LSP workspaceSymbol 결과의 파일 경로 접두를 본다.

## 전환 절차

**보통은 절차가 없다** — 원하는 트리의 파일 경로로 LSP 도구를 호출하면 끝(멀티플렉서가 라우팅).
default 인스턴스의 워크스페이스나 config 를 바꿔야 할 때만:

1. `~/.config/php-lsp-proxy/config.json` 수정 (plugin.json 은 건드리지 않는다).
2. 서버 재시작 — **반드시 프록시 PID 만** kill: `ps aux | grep 'php-lsp-proxy\.js' | grep -v grep | awk '{print $2}' | xargs kill`.
   intelephense 는 프록시가 함께 정리한다(exit 0). ⚠ intelephense 를 직접 kill 하지 말 것 — 프록시가
   비정상 종료(exit≠0)로 기록되면 **하네스가 respawn 을 멈추고**(크래시 보호, 실측) `/reload-plugins` 로만 복구된다.
3. 재기동: 다음 LSP 호출이 자동 respawn 되는 경우도 있으나(실측 수회 성공) **신뢰 불가** —
   "server is running" 고착으로 respawn 이 안 되는 사례 다수(reload 당 1회만 되는 정황). **원칙: kill 후 `/reload-plugins`.**
4. 검증: LSP workspaceSymbol → 결과 파일 경로 접두 확인.

⚠ 재시작 관련 하네스 실측 3종: ① 재시작 후 클라이언트가 세션의 과거 요청을 전부 리플레이,
② 간혹 신규 요청을 "server is running" 으로 거부(잠김 — reload 로만 해제), ③ 서버가 exit≠0 이면
respawn 영구 중단. **평상시엔 재시작 없이 filePath 라우팅만으로 쓰는 것이 정답**이고, 재시작은
캐시 수술 등 꼭 필요할 때만 + 반드시 reload 동반.

## ⚠ 인덱스 캐시 수술의 올바른 순서 (오염 재발 방지, 실측 2026-07-08)

intelephense 는 **종료 시 워크스페이스 상태를 다시 쓴다**. 살아있는 인스턴스 밑에서
`~/.cache/intelephense/<hash>` 를 삭제하면 죽어가는 인스턴스가 캐시를 되살려 재오염시킨다.
반드시: **① 프록시 kill → ② 프로세스 소멸 확인(ps) → ③ 캐시 삭제 → ④ `/reload-plugins`** 순서로.

## 인덱싱/동작 진단 (전부 실측 사례)

- 로그: `~/.config/php-lsp-proxy/logs/proxy-*.log` (기본 meta — 메서드 흐름 + initialize 전문 + 서버 logMessage). 전 페이로드는 config `"log": "full"` 후 서버 재시작.
- **오염 상태 캐시**: 새 워크스페이스인데 "Indexing finished. 0 of 0 files"(기동 수 초 만에 완료, 캐시 ≈15M=내장 stub 수준) → `~/.cache/intelephense/<hash>` 해당 디렉토리 삭제 + 서버 재시작으로 완치. 건강한 첫 인덱싱은 수천 파일이 queue 에 잡힌다(예: imweb 8,133).
- **workspaceSymbol 0건인데 로그의 wire 응답엔 결과가 있는 경우**: 하네스 표시 워밍업 플레이크 — 잠시 후 재시도하면 표시된다.
- **goToDefinition "No definition found"**: 하네스(2.1.202 실측)가 LocationLink[] 형식 응답을 표시하지 못하는 경우 있음 — wire(로그)에는 정답이 있다. **findReferences 로 대체**(정의 라인 포함, Location[] 형식이라 정상 표시). 필요시 로그의 targetUri/targetSelectionRange 를 직접 읽는다.
- **(v0.4.0 에서 해결) secondary child references 빈 결과의 근본 원인 = 인덱싱 레이스**: 요청이 child spawn 을 유발하므로 didOpen/질의가 워크스페이스 인덱싱 완료 전에 도착했고, **인덱싱 중 열린 문서는 참조 해석이 빈 결과로 굳는다**(시간이 지나도 회복 안 됨 — 오프라인 5단계 배제 실험으로 확정: intelephense 단독/상태파일/storagePath 동시공유/프록시 경유 전부 무죄, "didOpen 이 인덱싱보다 먼저"가 유일 재현 조건). 대책: 프록시가 **미인덱스 child 로 가는 textDocument/*·workspace/symbol 전체를 FIFO 보류**하고 indexingEnded 에 방출(타임아웃 90s). 신규 child 첫 질의에 인덱싱 시간(~3s)만큼 지연이 얹히는 것이 정상 동작.
- respawn 직후 position 기반 연산(hover/definition)은 didOpen 누락으로 서버가 null 을 줄 수 있다 — workspace 단위 연산부터 쓰면 무관.
- 하네스는 initialize rootUri 로 **세션 cwd** 를 보낸다(실측) — 프록시 재작성이 워크스페이스를 결정하는 유일한 지점.

## 제약 (실측 2026-07-08)

- LSP 설정 변수 치환(`${user_config.*}`, `${CLAUDE_PLUGIN_DATA}`) 미동작 — 그래서 launcher/config 경로는 전부 실경로.
- 서브에이전트에는 LSP 도구 자체가 없음 — LSP 작업은 메인 세션에서.
- `storagePath`(`~/.cache/intelephense`)는 워크스페이스별 캐시 키 분리 — 여러 트리 공유 안전.
- intelephense 기본 maxSize(1MB) 초과 파일은 인덱스 제외(예: localize_admin_kr_map.php) — 필요시 `intelephense.files.maxSize` 조정.
