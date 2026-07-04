# git-multi-account

한 머신에서 git/GitHub 계정이 2개 이상이라 매번 전환이 귀찮을 때, **전환을 자동화가 아니라 *제거*** 하는 설계 스킬.

## 아이디어
매번 무엇을 고르는 대신 **레포 폴더 위치 = 신원**으로 못박는다. 커밋 author·GPG 서명·push 인증이 폴더로 자동 라우팅되어 `gh auth switch` 나 수동 `git config user.email` 이 사라진다.

## 메커니즘 (2레이어)
- **신원·서명**: `~/.gitconfig` 의 `includeIf "gitdir:..."` → 폴더별 `[user]`(name/email/signingkey)
- **push 인증(HTTPS)**: include 파일의 credential helper 가 `gh auth token --user <계정>` 로 계정별 토큰을 뽑음 → **전역 gh active 상태와 무관**

## 담긴 것
- 대안 평가(개인계정 삭제 / Docker / 맥OS 유저 분리·`su` / SSH Host 별칭)와 채택 근거
- **함정**: `includeIf` 는 전역 credential 섹션보다 뒤(파일 맨 끝)에 와야 이김 — 순서 틀리면 조용히 실패
- 셋업 순서 + 검증법(`git credential fill`, 사설 레포 `ls-remote`, pre-push 훅 우회)
- 한계: `gh` CLI 서브커맨드는 여전히 전역 active 기준
- SSH 대안

자세한 내용은 [`skills/git-multi-account/SKILL.md`](skills/git-multi-account/SKILL.md).
