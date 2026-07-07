#!/usr/bin/env bash
# secrets/get.sh [--prime] <service-name> — ~/.secrets/<service-name>.gpg 를 복호화해 출력.
# --prime: 복호화 성공 여부만 확인하고 비밀값은 stdout 에 내지 않는다 — 사람이 비밀번호를
#   화면에 띄우지 않고 passphrase 캐시만 채우거나, Claude 가 캐시 생존을 확인할 때.
# passphrase 는 사람의 대화형 셸에서만 묻는다. Claude Code(CLAUDECODE=1) 등 비대화형 경로에선
# pinentry 를 절대 띄우지 않고(TUI 파손 방지) gpg-agent 캐시가 있을 때만 성공, 없으면 안내 후 실패.
# stdout 계약: 비밀값 외엔 아무것도 stdout 에 내지 않는다 (상태 메시지는 전부 stderr).
set -euo pipefail

prime=0
if [ "${1:-}" = "--prime" ]; then prime=1; shift; fi
[ $# -eq 1 ] || { echo "usage: get.sh [--prime] <service-name>" >&2; exit 1; }

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
  if [ "$prime" -eq 1 ]; then
    gpg --decrypt "$src" >/dev/null
    echo "OK: 복호화 성공 — passphrase 캐시 채워짐(~12h), 비밀값은 출력하지 않았습니다: $name" >&2
    exit 0
  fi
  exec gpg --decrypt "$src"
fi

# 비대화형: 캐시된 passphrase 로만 시도 — pinentry-mode cancel 은 캐시 미스 시 즉시 실패한다.
if [ "$prime" -eq 1 ]; then
  if gpg --batch --pinentry-mode cancel --quiet --decrypt "$src" >/dev/null 2>&1; then
    echo "OK: passphrase 캐시 살아 있음(비밀값 미출력): $name" >&2
    exit 0
  fi
elif gpg --batch --pinentry-mode cancel --quiet --decrypt "$src" 2>/dev/null; then
  exit 0
fi

echo "복호화 실패 — passphrase 캐시가 없어 비대화형 셸에서는 조회할 수 없습니다." >&2
echo "별도 터미널(사람의 대화형 셸)에서 직접 실행하세요: secret-get --prime $name" >&2
echo "(--prime 은 비밀번호를 화면에 출력하지 않고 캐시만 채웁니다. 성공하면 gpg-agent 가 12시간 캐싱해 이후 비대화형 조회가 가능해집니다)" >&2
exit 1
