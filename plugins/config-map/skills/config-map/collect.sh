#!/usr/bin/env bash
# config-map/collect.sh — Claude Code 설정 계층을 실측해 { base, nodes } JSON 으로 덤프.
#   base  = ~/.claude 전역 설정 (모든 경로가 상속)
#   nodes = 설정을 가진 각 경로 + base 대비 델타(추가/비활성)
# 원칙: (1) 읽기 전용 (2) 민감값 마스킹 — env 값·MCP 쿼리·토큰·메모리 내용은 방출 안 함.
# 의존: jq. 출력: stdout 단일 JSON.
set -euo pipefail

HOME_DIR="$HOME"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
BASE_SETTINGS="$CLAUDE_DIR/settings.json"
BASE_LOCAL="$CLAUDE_DIR/settings.local.json"
GLOBAL_JSON="$HOME/.claude.json"

command -v jq >/dev/null 2>&1 || { echo '{"error":"jq_not_found"}'; exit 0; }
tilde() { printf '%s' "${1/#$HOME_DIR/\~}"; }

# ── base = settings.json + settings.local.json 병합 (Claude 가 둘 다 로드; local 우선) ──
# 설정이 어느 파일에 있든(특히 전역 설정을 settings.local.json 으로 몰아둔 경우) 견고하게 읽는다.
# 스칼라·객체(mcpServers·enabledPlugins·env·hooks)는 local 우선 deep-merge, 권한 규칙은 union.
MERGED_BASE="$(mktemp)"; trap 'rm -f "$MERGED_BASE"' EXIT
jq -s '
  (.[0] // {}) as $m | (.[1] // {}) as $l |
  ($m * $l)
  | .permissions.allow = ((($m.permissions.allow // []) + ($l.permissions.allow // [])) | unique)
  | .permissions.deny  = ((($m.permissions.deny  // []) + ($l.permissions.deny  // [])) | unique)
  | .permissions.ask   = ((($m.permissions.ask   // []) + ($l.permissions.ask   // [])) | unique)
' <([ -f "$BASE_SETTINGS" ] && cat "$BASE_SETTINGS" || echo '{}') \
  <([ -f "$BASE_LOCAL" ] && cat "$BASE_LOCAL" || echo '{}') \
  > "$MERGED_BASE" 2>/dev/null || echo '{}' > "$MERGED_BASE"
BASE_SETTINGS="$MERGED_BASE"   # 이후 모든 base 읽기는 병합본을 소스로 삼는다

# ── base enabledPlugins 집합 (settings.json + settings.local.json 의 true 인 것) ──
base_plugins_json='[]'
{
  a='{}'; b='{}'
  [ -f "$BASE_SETTINGS" ] && a=$(jq -c '(.enabledPlugins // {})' "$BASE_SETTINGS" 2>/dev/null || echo '{}')
  [ -f "$BASE_LOCAL" ]    && b=$(jq -c '(.enabledPlugins // {})' "$BASE_LOCAL" 2>/dev/null || echo '{}')
  base_plugins_json=$(jq -nc --argjson a "$a" --argjson b "$b" '($a * $b) | to_entries | map(select(.value==true) | .key)')
}
# base MCP 서버 이름: settings(.local).json 의 mcpServers + ~/.claude.json 최상위 mcpServers
#   (claude mcp add -s user 는 파일이 아니라 ~/.claude.json 최상위 mcpServers 로 감 — 여기 안 읽으면 base 에서 누락됨)
base_mcp_json='[]'
[ -f "$BASE_SETTINGS" ] && base_mcp_json=$(jq -c '(.mcpServers // {}) | keys' "$BASE_SETTINGS" 2>/dev/null || echo '[]')
if [ -f "$GLOBAL_JSON" ]; then
  global_user_mcp=$(jq -c '(.mcpServers // {}) | keys' "$GLOBAL_JSON" 2>/dev/null || echo '[]')
  base_mcp_json=$(jq -nc --argjson a "$base_mcp_json" --argjson b "$global_user_mcp" '($a + $b) | unique')
fi

# ── BASE 블록 ──
sget(){ [ -f "$BASE_SETTINGS" ] && jq -r "$1" "$BASE_SETTINGS" 2>/dev/null || echo "${2:-unset}"; }
base_env_keys='[]'; [ -f "$BASE_SETTINGS" ] && base_env_keys=$(jq -c '(.env // {})|keys' "$BASE_SETTINGS" 2>/dev/null || echo '[]')
base_allow=0; base_deny=0
if [ -f "$BASE_SETTINGS" ]; then
  base_allow=$(jq '(.permissions.allow // [])|length' "$BASE_SETTINGS" 2>/dev/null || echo 0)
  base_deny=$(jq '(.permissions.deny // [])|length' "$BASE_SETTINGS" 2>/dev/null || echo 0)
fi
base_hooks='[]'
[ -f "$BASE_SETTINGS" ] && base_hooks=$(jq -c '(.hooks // {})|keys' "$BASE_SETTINGS" 2>/dev/null || echo '[]')
# base CLAUDE.md 체인: ~/.claude/CLAUDE.md + @import 대상(lessons)
base_claudemd='[]'
if [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
  lines=$(wc -l < "$CLAUDE_DIR/CLAUDE.md" | tr -d ' ')
  base_claudemd=$(jq -nc --arg p "$(tilde "$CLAUDE_DIR/CLAUDE.md")" --arg n "$lines" '[{path:$p, lines:($n|tonumber)}]')
  # @import 로 끌어오는 파일(예: lessons.md)
  imp=$(grep -oE '@[[:graph:]]+' "$CLAUDE_DIR/CLAUDE.md" 2>/dev/null | sed 's/^@//' | head -5 || true)
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    f="${rel/#\~/$HOME_DIR}"; [ -f "$f" ] || continue
    base_claudemd=$(jq -c --arg p "$(tilde "$f")" '. + [{path:$p, imported:true}]' <<<"$base_claudemd")
  done <<<"$imp"
fi

base_block=$(jq -nc \
  --arg model "$(sget '.model' 'unset')" --arg effort "$(sget '.effortLevel' 'unset')" \
  --arg tui "$(sget '.tui' 'unset')" --arg theme "$(sget '.theme' 'unset')" \
  --arg skip "$(sget '.skipAutoPermissionPrompt' 'false')" \
  --argjson envKeys "$base_env_keys" --argjson allow "$base_allow" --argjson deny "$base_deny" \
  --argjson plugins "$base_plugins_json" --argjson mcp "$base_mcp_json" \
  --argjson hooks "$base_hooks" --argjson claudemd "$base_claudemd" \
  '{path:"~/.claude", model:$model, effort:$effort, tui:$tui, theme:$theme,
    skipAutoPermissionPrompt:($skip=="true"),
    envKeys:$envKeys, allow:$allow, deny:$deny,
    plugins:$plugins, mcp:$mcp, hooks:$hooks, claudemd:$claudemd}')

# ── 경로 델타 계산 ──
delta_for(){ # $1 = 절대 경로 → node JSON (또는 빈 문자열이면 skip 안 함, 항상 반환)
  local P="$1"
  # 이 경로의 .claude 가 곧 base 디렉토리면(대개 홈), base 자신을 델타로 오인하지 않게 pass-through 처리.
  if [ -e "$P/.claude" ] && [ "$P/.claude" -ef "$CLAUDE_DIR" ]; then
    jq -nc --arg path "$(tilde "$P")" '{path:$path, depth:0, kind:"passthru", files:[],
      add:{plugins:[], mcp:[], hooks:[], local:[], claudemd:[]}, off:{mcp:[]}}'
    return
  fi
  local pj="$P/.claude/settings.json" lj="$P/.claude/settings.local.json" mj="$P/.mcp.json"
  local files='[]' add_plugins='[]' add_mcp='[]' off_mcp='[]' add_hooks='[]' add_cmd='[]' local_comp='[]'

  # 존재 파일 수집
  local fl='[]'
  [ -f "$P/.claude/settings.json" ] && fl=$(jq -c '. + [".claude/settings.json"]' <<<"$fl")
  [ -f "$lj" ] && fl=$(jq -c '. + [".claude/settings.local.json"]' <<<"$fl")
  [ -f "$P/CLAUDE.md" ] && fl=$(jq -c '. + ["CLAUDE.md"]' <<<"$fl")
  [ -f "$P/.claude/CLAUDE.md" ] && fl=$(jq -c '. + [".claude/CLAUDE.md"]' <<<"$fl")
  [ -f "$mj" ] && fl=$(jq -c '. + [".mcp.json"]' <<<"$fl")
  [ -d "$P/.claude/agents" ] && fl=$(jq -c '. + [".claude/agents/"]' <<<"$fl")
  [ -d "$P/.claude/commands" ] && fl=$(jq -c '. + [".claude/commands/"]' <<<"$fl")
  [ -d "$P/.claude/skills" ] && fl=$(jq -c '. + [".claude/skills/"]' <<<"$fl")
  files="$fl"

  # settings(proj+local) 병합해서 델타 뽑기
  local merged='{}'
  [ -f "$pj" ] && merged=$(jq -c --slurpfile x "$pj" '. * ($x[0] // {})' <<<"$merged" 2>/dev/null || echo "$merged")
  [ -f "$lj" ] && merged=$(jq -c --slurpfile x "$lj" '. * ($x[0] // {})' <<<"$merged" 2>/dev/null || echo "$merged")

  # 플러그인: 이 경로에서 true 인데 base 엔 없는 것.
  # 주의: `$base | index(.)` 는 파이프가 `.` 를 $base 로 재바인딩해 항상 truthy → 원소를 $k 로 묶는다.
  add_plugins=$(jq -nc --argjson merged "$merged" --argjson base "$base_plugins_json" '
    ($merged.enabledPlugins // {} | to_entries | map(select(.value==true)|.key)) as $here
    | [ $here[] | . as $k | select( ($base | index($k)) == null ) ]')

  # MCP: .mcp.json 서버 + enabledMcpjsonServers = 추가 / disabledMcpjsonServers = 비활성
  local mcpfile='[]'
  [ -f "$mj" ] && mcpfile=$(jq -c '(.mcpServers // {})|keys' "$mj" 2>/dev/null || echo '[]')
  add_mcp=$(jq -nc --argjson f "$mcpfile" --argjson merged "$merged" \
    '($merged.enabledMcpjsonServers // []) as $en | ($f + $en) | unique')
  off_mcp=$(jq -nc --argjson merged "$merged" '($merged.disabledMcpjsonServers // []) | unique')

  # local scope MCP: claude mcp add(기본 scope=local) 는 파일로 안 남고 ~/.claude.json 의
  # .projects[이 절대경로].mcpServers 에 저장됨 — 그 서버명도 이 경로의 add.mcp 로 합류시킨다.
  local local_mcp='[]'
  [ -f "$GLOBAL_JSON" ] && local_mcp=$(jq -c --arg p "$P" '(.projects[$p].mcpServers // {}) | keys' "$GLOBAL_JSON" 2>/dev/null || echo '[]')
  add_mcp=$(jq -nc --argjson a "$add_mcp" --argjson b "$local_mcp" '($a + $b) | unique')

  # 훅: 이 경로 settings 의 hooks 이벤트명
  add_hooks=$(jq -nc --argjson merged "$merged" '($merged.hooks // {}) | keys')

  # 로컬 컴포넌트 디렉토리
  local lc='[]'
  [ -d "$P/.claude/agents" ]   && lc=$(jq -c '. + ["agents"]' <<<"$lc")
  [ -d "$P/.claude/commands" ] && lc=$(jq -c '. + ["commands"]' <<<"$lc")
  [ -d "$P/.claude/skills" ]   && lc=$(jq -c '. + ["skills"]' <<<"$lc")
  local_comp="$lc"

  # CLAUDE.md 추가분
  local cmadd='[]'
  [ -f "$P/CLAUDE.md" ]        && cmadd=$(jq -c --arg p "$(tilde "$P/CLAUDE.md")" '. + [$p]' <<<"$cmadd")
  [ -f "$P/.claude/CLAUDE.md" ] && cmadd=$(jq -c --arg p "$(tilde "$P/.claude/CLAUDE.md")" '. + [$p]' <<<"$cmadd")

  # depth
  local rel="${P#$HOME_DIR/}"; local depth=0
  if [ "$P" = "$HOME_DIR" ]; then depth=0; else depth=$(awk -F/ '{print NF-1}' <<<"$rel"); fi

  # kind 판정
  local nfiles; nfiles=$(jq 'length' <<<"$files")
  local ndelta; ndelta=$(jq -nc --argjson a "$add_plugins" --argjson b "$add_mcp" --argjson c "$off_mcp" \
    --argjson d "$add_hooks" --argjson e "$local_comp" --argjson f "$cmadd" \
    '($a|length)+($b|length)+($c|length)+($d|length)+($e|length)+($f|length)')
  local kind='passthru'
  if [ "$P" = "$CLAUDE_DIR" ]; then kind='base';
  elif [ "$ndelta" -gt 0 ]; then kind='delta';
  elif [ "$nfiles" -gt 0 ]; then kind='thin';
  else kind='passthru'; fi

  jq -nc \
    --arg path "$(tilde "$P")" --argjson depth "$depth" --arg kind "$kind" \
    --argjson files "$files" \
    --argjson ap "$add_plugins" --argjson am "$add_mcp" --argjson om "$off_mcp" \
    --argjson ah "$add_hooks" --argjson lc "$local_comp" --argjson cm "$cmadd" \
    '{path:$path, depth:$depth, kind:$kind, files:$files,
      add:{plugins:$ap, mcp:$am, hooks:$ah, local:$lc, claudemd:$cm},
      off:{mcp:$om}}'
}

# ── 경로 목록: ~/.claude.json .projects(=Claude 가 실제 돈 cwd) + 파일시스템에서
#    .claude/settings*.json 를 가진 경로. 무거운/무관 디렉토리는 prune. dedup·정렬. ──
proj_paths=""
[ -f "$GLOBAL_JSON" ] && proj_paths=$(jq -r '(.projects // {}) | keys[]' "$GLOBAL_JSON" 2>/dev/null || true)

disc_paths=$(find "$HOME" -maxdepth 6 \
    \( -name node_modules -o -name .git -o -path '*/.claude/plugins' -o -name Library \
       -o -name .Trash -o -name .cache -o -name .bun -o -name .npm -o -name .vscode \) -prune \
    -o -type f -path '*/.claude/settings*.json' -print 2>/dev/null \
  | sed -E 's#/\.claude/settings(\.local)?\.json$##' \
  | grep -vE 'claude_backup|/marketplaces/' | sort -u || true)

paths=$(printf '%s\n%s\n' "$proj_paths" "$disc_paths" | grep -v '^$' | sort -u)

nodes='[]'
while IFS= read -r P; do
  [ -n "$P" ] || continue
  [ -d "$P" ] || continue
  node=$(delta_for "$P")
  nodes=$(jq -c ". + [$node]" <<<"$nodes")
done <<<"$paths"
# 경로 사전순 정렬(트리 표시용)
nodes=$(jq -c 'sort_by(.path)' <<<"$nodes")

# ── 조립 ──
proj_count=$(jq 'length' <<<"$nodes")
jq -nc --argjson base "$base_block" --argjson nodes "$nodes" --argjson pc "$proj_count" \
  '{base:$base, nodes:$nodes,
    meta:{projectCount:$pc,
          resolution:"managed > 프로젝트 settings.local.json > 프로젝트 settings.json > 유저 base(~/.claude)"}}'
