# confirm-gate

> 위험·비가역 Bash 명령을 15초 native 다이얼로그로 게이트한다.
> **무응답(lazy)** 이면 명령 클래스별 기본값으로 자동 결정 — 비가역은 deny, 가역은 allow.

---

## 무엇을 하는가

`PreToolUse(Bash)` hook 으로 들어오는 명령을 두 목록과 매칭한다.

| 클래스 | 대상 (default 명령) | 무응답 시 |
|---|---|---|
| **DENY** (비가역/금지) | `sudo`, `pkill`, `git reset --hard`, `git clean -f`, `git checkout --`, `gh pr merge` | **deny** |
| **ALLOW** (가역/무영향) | `kill`, `killall`, `git push`, `git rebase -i`, `git add -i` | **allow** |

매칭되면 15초 macOS 다이얼로그(osascript)를 띄우고, 사용자가 누르면 그 결정을, **안 누르면 위 기본값**을 PreToolUse `permissionDecision` 으로 출력한다. 매칭 안 되는 명령은 아무 의견도 내지 않고(`exit 0`) 정상 권한 흐름으로 넘긴다.

"lazy" 의 의미: 매번 직접 승인을 누를 필요 없이, **방치하면 안전한 기본값으로 알아서 결정**된다는 것.

## 설치

```text
/plugin marketplace add Rockheung/plugings
/plugin install confirm-gate@plugings
```

⚠️ **중복 프롬프트 주의**: 이전에 `~/.claude/settings.json` 의 `hooks.PreToolUse` 에 같은
`timeout-deny.sh` 를 직접 등록해 두었다면, 플러그인 hook 과 **합산되어 다이얼로그가 두 번** 뜬다.
플러그인으로 옮길 때 settings.json 의 해당 항목을 제거할 것.

## 함께 쓰는 권한 설정 (참고 — 작성자 실사용 baseline)

confirm-gate 는 `settings.json` 의 `permissions.allow` / `permissions.deny` 와 **층위가 다르다**.

- **allow/deny 리스트**: 정적 매칭. allow 면 프롬프트 없이 실행, deny 면 무조건 차단.
- **confirm-gate(PreToolUse hook)**: allow 로 통과한 명령 중 **위험 부분집합**에만 15초 다이얼로그를 덧씌운다.

즉 `git push` · `pkill` · `git reset --hard` · `gh pr merge` 등은 allow 에 넣어 **평소 프롬프트를
없애되**, confirm-gate 가 그 위에 lazy 다이얼로그를 한 겹 더 씌우는 조합이다. (deny 리스트의
`rm -rf` 류는 confirm-gate 까지 갈 것도 없이 정적으로 차단.)

작성자가 실제로 쓰는 baseline (그대로 복붙해도 되는 일반 dev 권한 — 사내 정보 없음):

```jsonc
// ~/.claude/settings.json  ->  permissions
{
  "allow": [
    "WebFetch", "WebSearch",
    // 읽기 전용 조회 — 프롬프트 불필요
    "Bash(gh pr view:*)", "Bash(gh pr list:*)", "Bash(gh pr diff:*)", "Bash(gh pr checks:*)",
    "Bash(gh pr status:*)", "Bash(gh issue view:*)", "Bash(gh issue list:*)", "Bash(gh repo view:*)",
    "Bash(gh run view:*)", "Bash(gh run list:*)", "Bash(gh release view:*)", "Bash(gh release list:*)",
    "Bash(gh search:*)", "Bash(gh auth status:*)",
    "Bash(git remote -v)", "Bash(git remote show:*)", "Bash(git fetch:*)", "Bash(git ls-files:*)",
    "Bash(git ls-remote:*)", "Bash(git config --get:*)", "Bash(git config --list:*)", "Bash(git rev-parse:*)",
    "Bash(git for-each-ref:*)", "Bash(git tag -l:*)", "Bash(git tag --list:*)", "Bash(git stash list:*)",
    "Bash(git stash show:*)",
    "Bash(pnpm list:*)", "Bash(pnpm ls:*)", "Bash(pnpm why:*)", "Bash(pnpm outdated:*)", "Bash(pnpm view:*)",
    "Bash(npm ls:*)", "Bash(npm list:*)", "Bash(npm outdated:*)", "Bash(npm view:*)",
    "Bash(yarn list:*)", "Bash(yarn why:*)",
    "Bash(brew list:*)", "Bash(brew info:*)", "Bash(brew search:*)",
    "Bash(* --version)", "Bash(* --help)", "Bash(which:*)", "Bash(whereis:*)", "Bash(type:*)",
    "Bash(file:*)", "Bash(printenv:*)", "Bash(env)", "Bash(ps:*)", "Bash(uptime)", "Bash(date:*)",
    "Bash(pwd)", "Bash(whoami)", "Bash(id)", "Bash(hostname)", "Bash(uname:*)", "Bash(jq:*)",
    "Bash(tree:*)", "Bash(realpath:*)", "Bash(readlink:*)", "Bash(basename:*)", "Bash(dirname:*)",
    "Bash(xxd:*)", "Bash(od:*)", "Bash(md5:*)", "Bash(shasum:*)", "Bash(sha256sum:*)", "Bash(pbpaste)",
    "Bash(tsc --noEmit:*)",
    // ↓ 아래는 allow 로 평소 프롬프트는 없애되, confirm-gate 가 다이얼로그를 덧씌우는 대상
    "Bash(sudo:*)", "Bash(kill:*)", "Bash(killall:*)", "Bash(pkill:*)",
    "Bash(git push:*)", "Bash(git reset --hard:*)", "Bash(git clean -f:*)", "Bash(git clean -fd:*)",
    "Bash(git checkout --:*)", "Bash(git rebase -i:*)", "Bash(git add -i:*)", "Bash(gh pr merge:*)"
  ],
  "deny": [
    "Bash(rm -rf:*)", "Bash(rm -fr:*)", "Bash(chmod:*)", "Bash(chown:*)",
    "Bash(launchctl:*)", "Bash(systemctl:*)", "Bash(eval:*)",
    "Bash(gh pr close:*)", "Bash(gh pr comment:*)", "Bash(gh issue close:*)", "Bash(gh issue comment:*)",
    "Bash(gh repo delete:*)",
    "Read(~/.ssh/**)", "Read(~/.gnupg/**)", "Read(~/.aws/credentials)", "Read(~/.aws/config)"
  ]
}
```

설계 의도: **읽기/조회는 allow 로 마찰 제거**, **비가역 쓰기는 deny 로 정적 차단**, 그 사이
**"평소엔 허용하되 실수 방지가 필요한 위험 명령"** 만 confirm-gate 의 lazy 다이얼로그가 담당한다.

## 한글(멀티바이트) 안전

이전 버전은 명령 텍스트를 `system attribute`(환경변수)로 osascript 에 넘겨 한글이
`�湲 硫吏…` 식으로 깨졌다. confirm-gate 는 명령 텍스트를 **UTF-8 temp 파일에 쓰고
AppleScript 가 `read ... as «class utf8»` 로 읽어** 다이얼로그에 표시하므로 한글·이모지가
그대로 보인다. 버튼/제목/타임아웃 등 ASCII 값만 argv 로 전달.

## 플랫폼 / 폴백

- **macOS**: native 다이얼로그.
- **비-macOS 또는 osascript 부재**(Linux/CI): 다이얼로그 없이 곧바로 **클래스 기본값**을 적용
  (비가역=deny 안전쪽 유지, 가역=allow). 게이트 의미는 보존된다.

## 환경변수

| 변수 | 기본값 | 용도 |
|---|---|---|
| `CONFIRM_GATE_LOG` | `~/.claude/confirm-gate.log` | 로그 경로 |
| `CONFIRM_GATE_LOG_MAX_BYTES` | `524288` (512 KiB) | 초과 시 마지막 200줄만 남기고 로테이트 |

## 게이트 목록 수정

`hooks/timeout-deny.sh` 상단의 `GATED_DENY` / `GATED_ALLOW` 배열(정규식)을 편집한다.
패턴은 명령 문자열 앞부분에 앵커(`^…`)되어 있다.

## 구조

```
confirm-gate/
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json          # PreToolUse(Bash) → ${CLAUDE_PLUGIN_ROOT}/hooks/timeout-deny.sh
│   └── timeout-deny.sh      # 분류 → 다이얼로그/폴백 → permissionDecision JSON
└── README.md
```
