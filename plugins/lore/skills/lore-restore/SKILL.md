Restore the lore knowledge base (KB) from a backup (백업로드) — 예: 머신 이전·실수 삭제로 KB 가 비워진 뒤 되살릴 때.

$ARGUMENTS: 선택 옵션. `--from <tarball>` `--to <kb>` `--overwrite` `--list`

1. **백업 디렉토리**: `${LORE_BACKUP_DIR:-$HOME/.lore/backups}`.
   - `--list` 면 `lore-kb-*.tar.gz` 를 최신순으로 (날짜·크기 포함) 나열하고 종료.
   - `--from <tarball>` 이면 그 파일. 아니면 **가장 최신** `lore-kb-*.tar.gz` 자동 선택. 백업 0개면 안내 후 종료.

2. **복원 대상(target) KB 루트** 해석 (순서, `--to` 있으면 그것):
   `$LORE_KB` > git repo 안이면 `<repo>/docs/knowledge/` > `${CLAUDE_PLUGIN_ROOT}/data/knowledge/` > `~/.lore/knowledge/`.

3. **비파괴 기본** — target 에 기존 내용이 있으면:
   - 무엇이 덮일지(겹치는 파일 수) 먼저 보여주고 **사용자 확인**을 받는다.
   - `--overwrite` 명시 시에만 target 을 비우고 복원. 기본은 **merge**(tar 를 target 위에 풀어 같은 경로는 백업본으로 갱신, target 에만 있던 파일은 보존).
   - 확인 없이 덮어쓰지 마라.

4. **복원**: `tar xzf <tarball> -C <target 의 부모>` (아카이브가 KB basename 을 포함하므로 부모에 푼다). `.bundle` 백업이면 `git clone <bundle> <target>` 또는 `git -C <target> pull <bundle>`.

5. **검증·보고**: 복원 후 `_index.md` 존재 + `*.md` 개수, target 경로, 사용한 백업 파일 명시.

원칙: 되돌리기 어려운 덮어쓰기는 확인 후에만. 기존 KB 를 말없이 지우지 않는다(개발 작업 손실 사고 방지).
