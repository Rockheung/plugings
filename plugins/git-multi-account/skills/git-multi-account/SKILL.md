---
name: git-multi-account
description: 한 머신에서 git/GitHub 계정이 2개 이상이라 매번 전환(user.email 바꾸기·gh auth switch)이 귀찮을 때, 전환을 자동화가 아니라 *제거*하는 설계. 회사/개인 신원 분리, 폴더별 identity·서명·push 인증 자동 라우팅, "Claude가 인증 헷갈려서 사람이 switch 해주는" 상황 해소. 멀티계정 정리/설계/셋업 요청 시.
---

# git-multi-account — 전환을 없애는 설계

## 핵심 원칙
**전환을 자동화하지 말고 제거한다.** 매번 무엇을 "고르는" 대신, **레포 폴더 위치 = 신원**으로 못박는다. 그러면 사람도 에이전트도 아무것도 안 골라도 된다. `gh auth switch`·수동 `git config user.email` 이 통째로 사라지는 게 목표.

## 대안 평가 (거친 뒤 버린 것들)
- **개인 계정 삭제 / 원격 서버서 관리** — 문제를 옮길 뿐, 로컬 마찰 늘어남. ❌
- **Docker 격리 (깃 파일만 볼륨)** — helper 한 줄 문제에 컨테이너·uid·키체인·서명 재설정. 배보다 배꼽. ❌
- **맥OS 유저 분리 / `su - user`** — 격리는 확실하나 파일 소유권 지옥·키체인 미해제·두 번째 홈 유지, 게다가 **수동 전환이 되살아남**(목적 역행). 순수 편의엔 과잉 — 보안/규정상 물리 격리가 *목적*일 때만. ❌(편의 목적)
- **SSH Host 별칭** — 유효한 대안. remote URL로 키 자동 선택. HTTPS 안 쓰고 SSH 위주면 이쪽(아래 참고). ✅(조건부)

## 권장 아키텍처 — 2레이어, 둘 다 폴더로 자동
레이어를 분리해서 이해하는 게 중요하다. **신원 ≠ 인증.** GPG는 서명(신원)이라 push 인증을 대신 못 한다.

**1) 신원·서명** — `~/.gitconfig` 의 `includeIf "gitdir:..."` 로 폴더별 `[user]`(name/email/signingkey) 로드.
```gitconfig
[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig.work
```
`~/.gitconfig.work`: `[user] name/email/signingkey` + `[commit] gpgsign = true`.

**2) push 인증(HTTPS)** — include 파일의 credential helper가 `gh auth token --user <계정>` 로 계정별 토큰을 뽑는다. **전역 gh active 상태와 무관** → `gh auth switch` 불필요. 계정별 config 디렉토리 분리도, 재로그인도 없음.
```gitconfig
# ~/.gitconfig.work 안
[credential "https://github.com"]
    helper =
    helper = "!f() { echo username=WORK_LOGIN; echo password=$(gh auth token --user WORK_LOGIN); }; f"
```
전제: `gh auth login` 으로 두 계정 모두 로그인돼 있어야(`gh auth status` 로 확인). gh ≥ 2.40, `gh auth token --user` 지원.

## 함정 (반드시)
1. **includeIf 는 `~/.gitconfig` 맨 끝에.** credential.helper 는 누적되고 빈 값(`helper =`)이 리스트를 리셋하며 **나중 로드가 이긴다.** 전역 `[credential "https://github.com"]` 섹션보다 includeIf 가 **뒤**에 와야 per-dir helper 가 이김. 위에 두면 전역이 덮어써서 조용히 실패.
2. **`gitdir:` 는 끝에 `/`** 를 붙여야 폴더 전체 매칭.
3. helper 안 gh 는 **절대경로 권장**(`$(command -v gh)` 로 확인; 예 `/opt/homebrew/bin/gh`). git credential 실행 시 PATH 제한될 수 있음.
4. 좁은 scope 우선. 특정 레포 한 폴더만이면 그 경로로, 상위 전체로 넓히지 말 것(요청 범위대로).

## 셋업 순서
1. `gh auth status` — 두 계정 로그인·로그인명 확인.
2. include 파일 2개에 각각 `[user]`(있으면 유지) + credential helper 추가.
3. `~/.gitconfig` 의 includeIf 블록들을 **맨 끝으로** 이동(+ 새 폴더 매핑 추가).
4. 검증(아래).

## 검증 (그럴듯함 ≠ 확인)
- **토큰 라우팅**: 각 레포에서
  `printf 'protocol=https\nhost=github.com\n\n' | git credential fill` → `username=` 이 그 폴더 계정인지.
- **끝단 인증**: 사설 레포 `git ls-remote origin HEAD` (인증 실패면 refs 못 받음). 또는 `git push --dry-run origin HEAD`.
  - 주의: **pre-push 훅**이 원격 도달 전 막으면 인증이 안 태워짐 → `ls-remote` 로 우회.
  - `push --dry-run` 의 `[rejected] fetch first` / `403 archived` 는 **인증은 성공**했다는 신호(원격에 닿음).
- **결정적 증거**: 전역 active 를 A로 둔 채 **B 폴더가 B 토큰**으로 인증되면 = 전역 상태 안 타고 위치로만 라우팅됨.

## 한계
`git` 은 위치로 라우팅되지만, **`gh` CLI 서브커맨드(`gh pr create`/`gh repo`)는 여전히 전역 active 계정 기준**(git 아니라 gh 자체 동작). 필요하면 `gh -R owner/repo …` 로 명시하거나, 계정별 `GH_CONFIG_DIR` 을 셸별로 걸어 분리(그럼 gh 서브커맨드까지 폴더/셸별 자동).

## SSH 대안 (HTTPS 안 쓸 때)
`~/.ssh/config` 에 `Host github.com-work` / `github.com-personal` 별칭 + 계정별 IdentityFile, include 파일에 `[url "git@github.com-work:"] insteadOf = git@github.com:`. remote URL(→폴더)로 키 자동 선택. gh helper 불필요. gh 서브커맨드 한계는 동일.
