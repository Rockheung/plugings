# php-lsp-proxy

PHP LSP(intelephense)를 **stdio 프록시 멀티플렉서** 뒤에서 구동하는 Claude Code 플러그인.

핵심 아이디어: **LSP 도구 호출의 파일 경로가 곧 워크스페이스 선택이다.** 요청 uri 가 속한
git toplevel(마커 파일 존재 시)별로 intelephense 인스턴스를 lazy spawn 해 라우팅하므로,
메인 체크아웃이든 git worktree 든 그 트리의 파일 경로로 호출하면 자동으로 그 트리가
인덱싱·응답한다. 설정 수정도, 서버 재시작도, `/reload-plugins` 도 필요 없다.

## 왜 프록시인가 (하네스 실측 제약)

- Claude Code 는 LSP `initialize` 의 rootUri 로 **세션 cwd** 를 보낸다 — 워크스페이스를 제어할
  지점이 이 프록시의 재작성뿐이다.
- LSP 설정의 변수 치환(`${user_config.*}`, `${CLAUDE_PLUGIN_DATA}`)이 미동작(실측) — 동적
  워크스페이스를 설정 파일로 표현할 수 없다.
- intelephense 는 **워크스페이스 인덱싱 중에 didOpen 된 문서의 참조 해석이 빈 결과로 굳는다**
  (시간이 지나도 회복 안 됨, 실측). on-demand spawn 은 항상 이 레이스를 밟으므로, 프록시가
  미인덱스 인스턴스로 가는 `textDocument/*`·`workspace/symbol` 을 인덱싱 완료(+settle 유예)까지
  FIFO 보류한다.

## 동작

1. **워크스페이스 결정** (default 인스턴스): argv `--workspace <p>`|`--workspace=<p>`|positional
   > env `PHP_LSP_WORKSPACE` > cwd 의 git toplevel(autoDetect, 마커 매치 시) > config `defaultWorkspace`.
2. **라우팅**: 요청 uri 의 git toplevel 별 인스턴스 lazy spawn (동시 수는 `maxServers`, 기본 3, LRU).
3. **fan-out**: `workspace/symbol` 은 살아있는 전 인스턴스에 뿌려 병합.
4. **didOpen 합성**: 하네스가 didOpen 을 생략하면(파일 단위 북키핑) 디스크에서 읽어 합성.
5. **로깅**: `~/.config/php-lsp-proxy/logs/proxy-*.log` (config `log`: off|meta|full).

## 설정 — `~/.config/php-lsp-proxy/config.json`

```json
{
  "defaultWorkspace": "/abs/path/to/php/repo",
  "autoDetect": true,
  "markers": ["composer.json", "index.php", "html"],
  "server": "intelephense",
  "serverArgs": ["--stdio"],
  "maxServers": 3,
  "log": "meta"
}
```

## 설치 캐비앳 (중요)

변수 치환 미동작 때문에 `plugin.json` 의 두 경로가 **실경로 하드코딩**이다. 설치 후 직접 수정할 것:

- `lspServers.intelephense.args[0]` → 이 플러그인이 설치된 실제 경로의 `scripts/php-lsp-proxy.js`
- `initializationOptions.storagePath` → 사용자 홈의 캐시 경로 (예: `~/.cache/intelephense` 실경로)

intelephense 는 전역 설치 필요: `npm i -g intelephense`.

## 운용 시 알아둘 것

자세한 절차·진단은 동봉 스킬 `php-lsp-workspace` 참조. 요약:

- 재시작이 필요하면 **프록시 PID 만** kill(자식 intelephense 는 프록시가 정리). intelephense 를
  직접 kill 하면 exit≠0 크래시로 기록돼 하네스가 respawn 을 멈춘다(reload 로만 복구). kill 후엔
  `/reload-plugins` 동반이 원칙(자동 respawn 은 간헐적).
- 인덱스 캐시 수술 순서: **프록시 kill → 프로세스 소멸 확인 → 캐시 삭제 → reload**.
  intelephense 는 종료 시 상태를 다시 쓰므로 순서를 어기면 오염이 재발한다.
- 하네스(CC 2.1.202 실측) 표시 quirk: goToDefinition 의 LocationLink[] 응답을 표시 못 하는 경우
  있음 → findReferences 로 대체(정의 라인 포함).

## 검증

`shortOpenTag: true` + `.cm/.sub/.cls` 확장자 매핑으로 short tag 비중이 높은 레거시 PHP
모노리스(9천+ 파일)에서 실측 검증: 전체 인덱싱 ~3초, 크로스파일 references/workspaceSymbol 정상,
worktree 2개 동시 서빙 + fan-out 병합 정상.
