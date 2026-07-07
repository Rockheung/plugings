#!/usr/bin/env bash
# secrets/store.sh <service-name> — 비밀값을 GPG 대칭키(passphrase)로 암호화해 ~/.secrets/<service-name>.gpg 로 저장.
# <service-name>에 "/"를 쓰면 하위 폴더가 생긴다 — 같은 호스트에 계정이 여럿일 때 <host>/<계정식별자> 형태로.
# macOS(osascript 있음): 비밀값을 터미널이 아닌 GUI 팝업(hidden answer)으로 입력받는다.
# 그 외: 대화형 stdin — 내용 입력 후 Ctrl+D. (passphrase 는 어느 경우든 gpg 가 별도로 대화형 프롬프트.)
# 사람의 대화형 셸 전용 — Claude Code(CLAUDECODE=1)나 TTY 없는 경로에선 실행을 거부하고 안내만 낸다.
set -euo pipefail

[ $# -eq 1 ] || { echo "usage: store.sh <service-name>  (내용은 stdin, 끝나면 Ctrl+D)" >&2; exit 1; }

name="$1"
dest="$HOME/.secrets/$name.gpg"

if [ -n "${CLAUDECODE:-}" ] || [ ! -t 0 ]; then
  echo "secret-store 는 passphrase·비밀값 입력에 대화형 프롬프트가 필요해 사람이 직접 실행해야 합니다." >&2
  echo "별도 터미널(사람의 대화형 셸)에서 실행하세요: secret-store $name" >&2
  exit 1
fi

# 파일명/폴더명 충돌 검사: 같은 호스트를 "단일 계정 파일"과 "다중 계정 폴더"로 동시에 쓰지 못하게 막는다.
if [[ "$name" == */* ]]; then
  host="${name%%/*}"
  flat="$HOME/.secrets/$host.gpg"
  if [ -e "$flat" ]; then
    echo "충돌: $flat (단일 계정 파일)이 이미 있습니다. 같은 호스트에 다중 계정($name)을 추가하려면 먼저 $flat 를 계정별로 옮기거나 지우세요." >&2
    exit 1
  fi
else
  dir="$HOME/.secrets/$name"
  if [ -d "$dir" ]; then
    echo "충돌: $dir/ (다중 계정 폴더)가 이미 있습니다. 이 호스트는 이미 계정이 여럿이니 <host>/<계정식별자> 형태로 저장하세요 (예: $name/<계정>)." >&2
    exit 1
  fi
fi

mkdir -p "$(dirname "$dest")"
chmod -R 700 ~/.secrets

if [ -e "$dest" ]; then
  read -r -p "$dest 가 이미 있습니다. 덮어쓸까요? [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "취소"; exit 1; }
fi

if [[ "$(uname)" == "Darwin" ]] && command -v osascript >/dev/null 2>&1; then
  if ! secret=$(osascript -e "text returned of (display dialog \"secret-store: $name\" default answer \"\" with hidden answer with title \"secret-store\")" 2>/dev/null); then
    echo "취소됨 (팝업에서 Cancel)" >&2
    exit 1
  fi
  printf '%s\n' "$secret" | gpg --symmetric --cipher-algo AES256 -o "$dest"
  unset secret
else
  gpg --symmetric --cipher-algo AES256 -o "$dest"
fi
chmod 600 "$dest"
echo "저장됨: $dest"
