#!/usr/bin/env bash
# secrets/get.sh <service-name> — ~/.secrets/<service-name>.gpg 를 복호화해 출력.
# passphrase 는 사람의 대화형 셸에서만 묻는다. Claude Code(CLAUDECODE=1) 등 비대화형 경로에선
# pinentry 를 절대 띄우지 않고(TUI 파손 방지) gpg-agent 캐시가 있을 때만 성공, 없으면 안내 후 실패.
set -euo pipefail

[ $# -eq 1 ] || { echo "usage: get.sh <service-name>" >&2; exit 1; }

name="$1"
src="$HOME/.secrets/$name.gpg"

if [ ! -f "$src" ]; then
  if [ -d "$HOME/.secrets/$name" ]; then
    echo "없음: $src — $name 은 다중 계정 호스트입니다. 등록된 계정:" >&2
    find "$HOME/.secrets/$name" -type f -name '*.gpg' | sort | while IFS= read -r f; do
      rel="${f#"$HOME/.secrets/"}"
      echo "  ${rel%.gpg}" >&2
    done
    echo "<host>/<계정식별자> 형태로 다시 시도하세요." >&2
  else
    echo "없음: $src (등록 목록: secret-list)" >&2
  fi
  exit 1
fi

# 사람의 대화형 셸: pinentry 허용 (Claude Code 경유가 아니고 stdin 이 TTY 일 때만)
if [ -z "${CLAUDECODE:-}" ] && [ -t 0 ]; then
  exec gpg --decrypt "$src"
fi

# 비대화형: 캐시된 passphrase 로만 시도 — pinentry-mode cancel 은 캐시 미스 시 즉시 실패한다.
if gpg --batch --pinentry-mode cancel --quiet --decrypt "$src" 2>/dev/null; then
  exit 0
fi

echo "복호화 실패 — passphrase 캐시가 없어 비대화형 셸에서는 조회할 수 없습니다." >&2
echo "별도 터미널(사람의 대화형 셸)에서 직접 실행하세요: secret-get $name" >&2
echo "(성공하면 gpg-agent 가 12시간 캐싱해 이후 비대화형 조회가 가능해집니다)" >&2
exit 1
