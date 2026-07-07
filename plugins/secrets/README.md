# secrets

로그인 정보·API 키 등 비밀값을 Claude memory 에 평문으로 남기지 않기 위한 스킬 + CLI.

- 값은 GPG 대칭키(passphrase)로 `~/.secrets/<service-name>.gpg` 에 암호화 저장, memory 엔 참조만.
- `secret-store <name>` — 저장. 사람의 대화형 셸 전용(Claude Code 경유·TTY 없음이면 거부 + 안내).
- `secret-get <name>` — 조회. 비대화형 경로(Claude Code 등)에선 pinentry 를 띄우지 않고 gpg-agent 캐시가 있을 때만 성공 — 캐시 만료 시 TUI 를 깨뜨리는 대신 "별도 터미널에서 직접 실행" 안내 후 실패.
- `secret-list` — 등록된 service-name 목록(복호화 없음, 비밀값 비노출).

## 설치

플러그인 설치 후, 스크립트를 PATH 에 링크한다 (플러그인 캐시 경로는 버전마다 바뀌므로 레포 체크아웃이나 고정 복사본을 원본으로):

```bash
SCRIPTS=<이 레포 체크아웃>/plugins/secrets/skills/secrets/scripts
ln -sf "$SCRIPTS/store.sh" ~/.local/bin/secret-store
ln -sf "$SCRIPTS/get.sh"   ~/.local/bin/secret-get
ln -sf "$SCRIPTS/list.sh"  ~/.local/bin/secret-list
```

gpg-agent 캐시(하루 한 번 passphrase 입력으로 12시간 사용)는 `~/.gnupg/gpg-agent.conf`:

```
default-cache-ttl 43200
max-cache-ttl 43200
```

자세한 사용법·보안 모델은 [skills/secrets/SKILL.md](skills/secrets/SKILL.md).
