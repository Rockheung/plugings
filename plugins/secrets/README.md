# secrets

> 비밀값은 **참조만 기억하고, 값은 암호화 파일에**.
> Claude 의 memory 파일(`~/.claude/**/memory/*.md`)은 매 세션 컨텍스트로 그대로 로드된다 —
> 거기 평문 비밀번호가 있으면 **모든 대화에 노출**된다. 이 플러그인은 값을 GPG 대칭키로
> `~/.secrets/<name>.gpg` 에 넣고, memory 엔 "어디 있는지"만 남기게 한다.

핵심 계약: **passphrase 는 사람의 대화형 셸에서만.** Claude Code 등 비대화형 경로는
pinentry 를 절대 띄우지 못하고, gpg-agent 캐시가 살아 있을 때만 조회에 성공한다.

![gpg](https://img.shields.io/badge/gpg-AES256%20symmetric-blue) ![pinentry](https://img.shields.io/badge/pinentry-human%20only-green) ![list](https://img.shields.io/badge/secret--list-no%20decrypt-lightgrey)

---

## 명령 3종

| 명령 | 실행 주체 | 하는 일 | 비대화형(Claude Code)에서 |
|---|---|---|---|
| `secret-store <name>` | **사람만** (별도 터미널) | 비밀값을 AES256 대칭키로 암호화 저장. macOS 는 GUI 팝업(hidden answer), 그 외 stdin+`Ctrl+D` | **거부** + 별도 터미널 안내 |
| `secret-get <name>` | Claude 자율 호출 가능 | 복호화해 비밀번호 한 줄 출력 | 캐시 있으면 성공 / 없으면 pinentry 없이 **즉시 실패 + 안내** |
| `secret-list` | Claude 자율 호출 가능 | 등록된 service-name 목록 (복호화 없음 = 비밀값 비노출, passphrase 불필요) | 항상 동작 |

## 하루 한 번 passphrase, 12시간 자유 조회

```
사람: 자기 터미널에서 secret-get <name> 실행 → pinentry 로 passphrase 입력
                     │
                     ▼
        gpg-agent 가 12시간 캐싱 (default/max-cache-ttl 43200)
                     │
                     ▼
Claude: secret-get 을 프롬프트 없이 자유 호출 ── 캐시 만료 시 안내와 함께 실패
```

## 비대화형 pinentry 가드 — 이 플러그인의 핵심 개선

예전엔 Claude Code 안에서 `secret-get` 을 부르다 캐시가 만료돼 있으면
**pinentry(curses)가 Claude Code TUI 위에 그려져 화면이 깨졌다.** 지금은:

| 판정 | 조건 | get 의 동작 |
|---|---|---|
| 사람의 대화형 셸 | `CLAUDECODE` 없음 **그리고** stdin 이 TTY | 평소처럼 pinentry 허용 |
| 비대화형 경로 | `CLAUDECODE=1` **또는** TTY 없음 | `--pinentry-mode cancel` — 캐시 히트면 조용히 성공, 미스면 즉시 exit 1 + "별도 터미널에서 직접 실행" 안내 |

`store` 는 판정이 비대화형이면 무조건 거부한다 — 저장은 passphrase·비밀값 입력 모두
대화형 프롬프트가 필요한, 원래부터 사람 전용 작업이다.

**IMPORTANT**: passphrase 를 커맨드라인 인자나 `--batch --passphrase` 로 넘기지 않는다 —
셸 히스토리·프로세스 목록에 남는다. 항상 gpg/pinentry 대화형 프롬프트로만.

## 이름 규칙 (service-name)

- 계정이 하나뿐인 사이트: `<host>` → `~/.secrets/<host>.gpg` (예: `imtest.me`)
- 같은 사이트에 계정 여럿: `<host>/<계정식별자>` → `~/.secrets/<host>/<계정>.gpg` (예: `imtest.me/qa-bot`)
- 경로에 호스트·계정이 이미 있으므로 **암호화 내용엔 비밀번호 한 줄만** — 계정 정보 중복 금지.
- `store`/`get` 은 같은 호스트가 단일 파일(`<host>.gpg`)과 폴더(`<host>/`)로 동시에 존재하지
  못하게 저장 전 충돌을 검사한다. `get` 을 호스트 이름만으로 부르면 하위 계정 목록을 나열해 준다.

## 설치

플러그인 설치 후, 스크립트를 PATH 에 링크한다. **플러그인 캐시 경로는 버전(SHA)마다 바뀌므로**
링크 원본은 레포 체크아웃(또는 고정 복사본)으로:

```bash
SCRIPTS=<이 레포 체크아웃>/plugins/secrets/skills/secrets/scripts
ln -sf "$SCRIPTS/store.sh" ~/.local/bin/secret-store
ln -sf "$SCRIPTS/get.sh"   ~/.local/bin/secret-get
ln -sf "$SCRIPTS/list.sh"  ~/.local/bin/secret-list
```

gpg-agent 캐시는 `~/.gnupg/gpg-agent.conf`:

```
default-cache-ttl 43200
max-cache-ttl 43200
```

의존성: `gpg` (`brew install gnupg`). Keychain 등 OS 종속 저장소를 쓰지 않는 이유 =
어느 OS 에서든 같은 방식으로 동작하게 하려고.

## memory 에는 이렇게만 남긴다

```markdown
---
name: login-<service>
description: <service> 로그인 계정 — 비밀번호는 GPG 암호화 파일에 저장
type: reference
---

- 계정: <아이디/닉네임/이메일 등>
- 조회: `secret-get <service-name>` (비밀번호 한 줄 출력, passphrase 캐시 필요할 수 있음)
```

계정식별자는 민감정보가 아니므로 평문 OK. 기존 memory 에서 평문 비밀번호를 발견하면:
사람이 `secret-store` 로 옮기고 → `secret-list` 로 확인 → memory 를 위 템플릿으로 교체.

## 보안 모델 — 정직한 한계

캐싱 때문에 "Claude 는 절대 못 꺼낸다"가 **아니다**. 캐시 유효시간(12h) 동안은 이 OS 계정으로
도는 무엇이든 꺼낼 수 있다. 남는 방어선은 두 가지뿐:

1. memory 처럼 매 세션 컨텍스트에 **자동으로 실리지 않는다** — 명시적 호출이 필요하고, 호출은 대화에 드러난다.
2. 캐시 만료 후엔 **사람 개입이 다시 필요**하다.

이 트레이드오프(하루 한 번 입력 ↔ 12시간 자동 조회)가 싫으면 `gpg-agent.conf` 의 ttl 을 줄이면 된다.

## 구성

```
secrets/
├── .claude-plugin/plugin.json
├── skills/secrets/
│   ├── SKILL.md            # 이름 규칙·절차·memory 템플릿·보안 모델
│   └── scripts/
│       ├── store.sh        # 저장 — 사람 전용 (비대화형 거부)
│       ├── get.sh          # 조회 — 비대화형은 캐시 히트만, pinentry 금지
│       └── list.sh         # 목록 — 복호화 없음
└── README.md
```

자세한 절차와 Claude 의 행동 규약은 [skills/secrets/SKILL.md](skills/secrets/SKILL.md).
