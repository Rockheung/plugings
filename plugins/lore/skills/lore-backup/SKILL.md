Back up the lore knowledge base (KB) to a durable location that survives plugin reinstall.

lore 의 기본 KB(`~/.lore/knowledge/` 또는 repo 내 `docs/knowledge/`)를 추가로 내구성 있는 곳에 백업해 둔다 — 머신 손실·실수 삭제 대비. (KB 를 `${CLAUDE_PLUGIN_ROOT}/data/` 캐시에 두면 업데이트 시 고아가 되니 거기 두지 말 것.)

$ARGUMENTS: 선택 옵션. `--dir <kb>` `--to <backupdir>` `--keep <N>` `--git-bundle`

1. **KB 루트 해석** (순서, `--dir` 있으면 그것):
   `$LORE_KB` > git repo 안이면 `<repo>/docs/knowledge/` > `~/.lore/knowledge/`.
   존재하지 않거나 비었으면 "백업할 KB 없음" 안내 후 종료.

2. **백업 디렉토리**: `${LORE_BACKUP_DIR:-$HOME/.lore/backups}`. `--to` 로 override. `mkdir -p`.

3. **아카이브 생성**:
   - `ts=$(date +%Y%m%d-%H%M%S)`
   - `tar czf <backupdir>/lore-kb-<ts>.tar.gz -C <KB의 부모> <KB의 basename>`
   - KB 가 git repo 이고 `--git-bundle` 이면 히스토리까지: `git -C <KB> bundle create <backupdir>/lore-kb-<ts>.bundle --all` 도 추가.

4. **로테이션**: `--keep <N>`(기본 10) — `lore-kb-*.tar.gz` 를 최신순 정렬해 N개 초과분(오래된 것)만 삭제. 삭제한 개수 명시(silent 삭제 금지).

5. **보고**: 백업 파일 경로 + 크기(`du -h`) + KB 항목 수(`find <KB> -name '*.md' | wc -l`) + 현재 보관 백업 수.

원칙: 읽기-only 로 KB 를 만지고(아카이브만 생성), 원본 KB 는 변경하지 않는다. 복원은 `lore-restore`.
