---
name: secrets
description: 로그인 정보·API 키 등 비밀값은 memory 파일에 평문으로 적지 않는다. GPG 대칭키(passphrase)로 ~/.secrets/<name>.gpg 에 암호화 저장하고, memory엔 "어디 있는지"만 reference 타입으로 남긴다. 등록 목록은 secret-list 로 조회. 새 로그인/토큰을 기억해야 하거나, 기존 memory에서 평문 비밀번호를 발견했거나, 등록된 비밀값을 찾아 쓸 때 사용.
---

# secrets — 비밀값은 참조만, 값은 암호화 파일에

## 왜
`~/.claude/memory/*.md`는 세션마다 컨텍스트로 그대로 로드된다. 여기 평문 비밀번호가 있으면 매 세션 대화 컨텍스트에 실제로 노출된다. OS 종속 없이(Keychain은 macOS 전용) 어디서든 같은 방식으로 쓰려고 GPG 대칭키 암호화를 쓴다.

## 이름 규칙 (service-name)
- 사이트에 계정이 하나뿐: `<host>` (예: `imtest.me`)
- 같은 사이트에 계정이 여럿: `<host>/<계정식별자>` (계정식별자 = 아이디·닉네임·이메일 등 뭐든) — `/`가 들어가면 `~/.secrets/<host>/` 하위에 계정별 파일이 생긴다 (예: `imtest.me/heungjun.park`, `imtest.me/qa-bot`)

호스트(+계정식별자)가 이미 경로에 있으니, **암호화하는 내용엔 비밀번호 한 줄만** 넣는다 — 계정 정보를 내용에 중복해서 넣지 않는다.

`store.sh`/`get.sh` 는 같은 호스트가 "단일 계정 파일"(`<host>.gpg`)과 "다중 계정 폴더"(`<host>/`)로 동시에 존재하지 못하게 저장 전 충돌을 검사한다 — 둘 다 있으면 그 호스트가 계정 1개인지 여러 개인지 모호해지기 때문.

## 목록 — Claude 가 자율 호출 가능
```bash
secret-list
```
`~/.secrets/` 에 등록된 service-name 을 한 줄씩 출력한다 (예: `imweb.me/design@imweb.me`). 복호화하지 않으므로 비밀값이 노출되지 않고, passphrase 도 필요 없다. "뭐가 등록돼 있지?" 또는 `secret-get` 이름이 기억나지 않을 때 먼저 이걸 부른다.

## 저장 — 사용자가 직접, 별도 터미널에서 (passphrase 는 대화형으로만)
```bash
secret-store <service-name>
```
**macOS(osascript 있음, 기본값)**: `display dialog ... with hidden answer` GUI 팝업이 떠서 거기 비밀번호를 입력한다 — 터미널에 값을 직접 타이핑하지 않는다. Cancel 누르면 저장 취소.

**그 외 OS(fallback)**: 실제 순서(반대로 착각하기 쉬움) —
1. 실행하면 **pinentry(passphrase 입력창)가 먼저** 뜬다 — 입력 + 확인 입력("Passphrases match"면 정상).
2. passphrase 확인이 끝나면 터미널은 아무 표시 없이 커서만 깜빡인다 — **이때부터 타이핑한 게 암호화 대상**이다. 라벨·계정 없이 **비밀번호 한 줄만**, 다 쳤으면 `Ctrl+D` (EOF).

어느 경우든 `~/.secrets/<service-name>.gpg` 로 저장되고, **passphrase 자체는 (macOS든 아니든) 항상 gpg/pinentry 의 대화형 프롬프트**로만 입력한다.

`store.sh` 는 **사람의 대화형 셸에서만 실행된다** — Claude Code 경유(`CLAUDECODE=1`)거나 TTY 가 없으면 실행을 거부하고 별도 터미널 안내만 낸다. Claude 는 이 저장 명령을 대신 실행하지 않고, 사용자에게 **별도 터미널에서** 직접 실행하도록 안내한다.

**IMPORTANT: passphrase 를 커맨드라인 인자나 `--batch --passphrase`로 넘기지 않는다** — 셸 히스토리·프로세스 목록에 남는다. 항상 대화형 프롬프트로 입력하게 한다.

## 조회 — Claude 가 자율 호출 가능 (단, 캐시 있을 때만 성공)
```bash
secret-get <service-name>            # 비밀값 한 줄을 stdout 에 출력
secret-get --prime <service-name>    # 복호화 성공만 확인, 비밀값은 출력하지 않음
```
`~/.gnupg/gpg-agent.conf` 에 `default-cache-ttl`/`max-cache-ttl` 12시간(43200초)으로 설정돼 있다. 즉 사용자가 하루 한 번(자기 터미널에서 `secret-get --prime` 실행 시) passphrase 를 입력하면, 이후 12시간은 gpg-agent 가 캐싱해 Claude 가 `secret-get` 을 프롬프트 없이 자유롭게 호출할 수 있다.

`--prime` 은 stdout 에 아무것도 내지 않는다(상태 메시지는 stderr) — 용도 두 가지:
- **사람**: 비밀번호를 터미널 화면·스크롤백에 띄우지 않고 passphrase 캐시만 채울 때. 사용자에게 캐시 갱신을 안내할 땐 항상 이 형태로 안내한다.
- **Claude**: 비밀값을 대화 컨텍스트에 노출하지 않고 캐시 생존 여부만 확인할 때 (살아 있으면 exit 0).

`get.sh` 는 실행 경로에 따라 다르게 동작한다:
- **사람의 대화형 셸**(TTY 있음 + `CLAUDECODE` 없음): 평소처럼 pinentry 로 passphrase 를 물을 수 있다.
- **비대화형 경로**(Claude Code 등): `--pinentry-mode cancel` 로 **pinentry 를 절대 띄우지 않는다** — 캐시가 살아 있으면 조용히 성공, 캐시가 없으면 즉시 실패하며 "별도 터미널에서 `secret-get --prime <name>` 을 직접 실행하라"는 안내를 낸다. (예전엔 캐시 만료 시 pinentry 가 Claude Code TUI 위에 그려져 화면을 깨뜨렸다 — 그걸 막는 가드다.)

Claude 는 `secret-get` 이 이 안내와 함께 실패하면 사용자에게 별도 터미널에서 `secret-get --prime <name>` 을 한 번 실행해 캐시를 채워달라고 요청한다 (`--prime` 이므로 비밀번호가 사용자 화면에도 찍히지 않는다).

**주의**: 이 캐싱 때문에 "Claude 는 절대 못 꺼낸다"는 아니게 된다 — 이 macOS 계정으로 실행되는 건 뭐든 캐시 유효시간 동안 꺼낼 수 있다. 남는 방어선은 (1) memory 파일처럼 매 세션 컨텍스트에 자동으로 실리지 않고 명시적 호출이 필요하다는 것, (2) 캐시 만료 후엔 사람 개입이 다시 필요하다는 것 두 가지뿐이다.

`secret-store`/`secret-get`/`secret-list` 는 PATH(예: `~/.local/bin/`)에 걸린 이 스킬의 `scripts/{store,get,list}.sh` 심볼릭 링크다 — 설치는 플러그인 README 참고.

## memory 기록 템플릿
값이 아니라 참조만 남긴다. 계정식별자는 민감정보가 아니므로 평문으로 적어도 되고, 비밀번호는 `secret-get` 출력(한 줄)으로만 조회한다:
```markdown
---
name: login-<service>
description: <service> 로그인 계정 — 비밀번호는 GPG 암호화 파일에 저장
type: reference
---

- 계정: <아이디/닉네임/이메일 등>
- 조회: `secret-get <service-name>` (비밀번호 한 줄 출력, passphrase 캐시 필요할 수 있음)
```

## 기존 평문 비밀번호를 발견했을 때
1. 사용자에게 별도 터미널에서 `secret-store <service-name>` 실행을 안내하고 내용 입력을 맡긴다(대화형 — Claude 가 값을 대신 입력하지 않는다).
2. 저장 확인되면(`secret-list` 로 확인 가능) memory 파일을 위 템플릿으로 교체하고 평문 값은 파일에서 제거한다.
3. `~/.secrets/*.gpg` 는 git 추적 금지 대상 — 새 레포에 두는 경우가 아니면 보통 무관(홈 디렉토리).
