#!/usr/bin/env bash
# secrets/list.sh — ~/.secrets 에 등록된 service-name 목록을 출력. 복호화 없음(비밀값 비노출)이라 Claude 가 자유롭게 호출 가능.
set -euo pipefail

root="$HOME/.secrets"
[ -d "$root" ] || { echo "등록된 비밀값이 없습니다 ($root 없음)"; exit 0; }

names=$(find "$root" -type f -name '*.gpg' | sort | while IFS= read -r f; do
  rel="${f#"$root"/}"
  printf '%s\n' "${rel%.gpg}"
done)

if [ -n "$names" ]; then
  printf '%s\n' "$names"
else
  echo "등록된 비밀값이 없습니다"
fi
