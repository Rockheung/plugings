---
name: eco-mode
description: 이 세션이 오케스트레이터가 되어 구현·조사·수정을 herdr 새 탭의 opencode(모델은 인자로 고른다: bro · eco · angry)에 맡기고, 적대적 리뷰는 advisor 에 맡기는 작업 방식. "eco-mode 로 해", "deepseek flash 에 맡겨", "오케스트레이터로 진행해" 라고 하거나, Agent 도구의 서브에이전트를 띄우려 할 때 대신 쓴다. 탭을 띄워 모델을 고정하는 명령, 일을 넘기고 결과를 받는 루프, 리뷰→조치 반복의 종료 조건을 담는다.
---

# eco-mode

진행하는 세션은 **오케스트레이터**다. 직접 구현하지 않고 세 가지를 한다.

| 일 | 맡는 쪽 |
|---|---|
| 구현·조사·재현·수정 | herdr 로 현재 workspace 의 새 탭에 띄운 opencode, 모델은 아래 "인자" 표로 고른다. 항목이 여럿이면 그 opencode 가 항목마다 자기 서브에이전트를 띄운다 |
| 적대적 리뷰 | `advisor` 도구 |
| 지시문 쓰기, 결과 검증, 커밋·푸시 판단, 사용자 보고 | 오케스트레이터(이 세션) |

Agent 도구의 서브에이전트는 쓰지 않는다. herdr 조작의 일반 절차(blocked 처리, 권한 세탁 금지, 화면 텍스트로 판정하지 않기)는 `session-delegation` 스킬에 있다. 이 스킬은 그 위에 얹는 것만 적는다.

## 인자: 일꾼 모델 고르기

스킬 인자 문자열로 일꾼 모델 `<모델>` 을 정한다. 인자에 단어 `angry` 가 있으면 셋째 줄, 단어 `eco` 가 있으면 둘째 줄이다. 그 밖의 경우(인자 없음, `bro`)는 첫째 줄이다.

| 모드 | `<모델>` | 비용 부담 |
|---|---|---|
| `bro` (기본) | `deepseek/deepseek-flash` | 조직 부담(기존 `deepseek` 프로바이더) |
| `eco` | `opengateway/deepseek/deepseek-v4.1-flash-eco` | 사용자 본인 부담(OpenGateway 키) |
| `angry` | `opengateway/deepseek/deepseek-v4.1-flash-ultrafast` | 사용자 본인 부담(OpenGateway 키) |

- `opengateway/` 모델은 탭을 띄우기 전에 `opencode models | grep -x '<모델>'` 의 종료 코드가 0 인지 본다. 아니면 일꾼을 띄우지 않고 사용자에게 `opencode.json` 의 `opengateway` 프로바이더 설정을 묻는다.
- 한 세션에서 일꾼 모델을 섞지 않는다. 인자가 바뀌면 사용자에게 알리고 기존 탭을 닫은 뒤 다시 띄운다.

### angry 모드 사용 가이드

`angry` 모델은 OpenGateway 가 저지연용으로 최적화해 카탈로그에 묶어 둔 변형이다. 일반 모델과 다른 점은 다음과 같다.

- **동시 요청 한도:** API 키·모델별로 동시에 처리하는 요청 수에 상한이 있다(수치는 문서에 없다). 넘으면 즉시 HTTP 429(`concurrency_limit_exceeded`, `Retry-After` 포함)이고, 서비스가 과부하면 키 한도와 관계없이 HTTP 529(`overloaded`)다. 일꾼 지시문에 다음을 넣는다: 서브에이전트의 병렬 측정은 적게 띄우고, 429·529 가 나오면 `Retry-After` 만큼 기다려 최대 3번 다시 시도하며, 그래도 실패하면 멈추고 결과 파일 맨 위에 적는다. 한도 상향은 OpenGateway 지원팀에 요청한다.
- **장문맥 할증:** 한 요청의 총 입력이 256K 토큰을 넘으면 그 요청 전체의 입력 가격이 2배다(캐시 읽기와 출력은 제외). 컨텍스트 창이 1,000,000 이므로 mini 화면의 사용률 표시가 25% 를 넘기 전에 항목을 나눠 새 세션에서 이어 간다.
- **자동 프롬프트 캐싱:** 캐시 TTL 은 5분이고 캐시 읽기는 더 싼 가격으로 과금된다. 지시문은 고정 내용(규칙·검사 명령)을 앞에, 가변 내용(항목 본문)을 뒤에 둔다. 일꾼이 5분 넘게 멈추면 캐시가 만료된다.
- **시간대별 가격:** 할인율이 시각에 따라 바뀐다. 띄우기 전에 아래 명령으로 `discount_percent`, `until`, `next` 를 본다.
  `curl -s --max-time 10 https://apis.opengateway.ai/v1/models | jq '.data[]|select(.id=="deepseek/deepseek-v4.1-flash-ultrafast")|.pricing'`
- **모델 상태:** 새로 쓰는 `-ultrafast` 모델은 카탈로그 `status` 가 `active` 인 것만 고른다. `deprecated` 는 유예 기간 동안만 쓸 수 있다.
- **reasoning 출력:** 출력 토큰 상한을 아주 작게 주면(`max_tokens` 20) `content` 가 비고 reasoning 만 나오고 `finish_reason` 이 `length` 로 끝났다.

## 1. 일꾼 탭을 띄운다

```sh
# 내 pane 이 속한 workspace 를 실측한다(환경변수는 낡을 수 있다)
herdr agent list | python3 -c "import json,sys;[print(a['pane_id'],a.get('cwd')) for a in json.load(sys.stdin)['result']['agents']]"

# 탭을 만든다
herdr tab create --workspace <ws> --cwd <작업 경로> --label "<짧은 이름>" --no-focus

# 일꾼을 opencode mini 로 띄운다(인자에 일감을 넣지 않는다)
herdr agent start <머신>-<cwd>-<번호>-<주제> --kind opencode --pane <pane id> -- mini -m <모델>

# 모델을 확인한다: 입력란 아래 줄에 선택한 모델 이름이 보여야 한다
herdr pane read <pane id> --source recent-unwrapped --lines 30 | grep -i "flash"
```

- `tab create` 직후에는 셸이 아직 준비되지 않아 `agent start` 가 `agent_pane_busy` 로 거부될 수 있다. 몇 초 기다렸다가 같은 명령을 다시 건다.

- 일꾼은 `opencode mini` 로 띄운다. mini 는 `-m` 으로 모델을 받고, 출력이 host scrollback 에 남아 `pane read` 로 전부 읽힌다. 전역 설정 파일과 작업 경로에는 아무것도 쓰지 않는다.
- mini 에는 `--auto` 가 없다. `opencode.json` 의 `permission` 에서 `ask` 인 도구를 쓰면 권한 대화상자에서 멈추고, herdr 는 그 상태를 `blocked` 로 잡는다. 아래 기다리는 루프가 `blocked` 도 함께 본다.
- 모델 이름은 `opencode models | grep -i flash` 로 확인한다. 2026-11-20 기준 목록에 `deepseek/deepseek-flash`, `opengateway/deepseek/deepseek-v4.1-flash-eco`, `opengateway/deepseek/deepseek-v4.1-flash-ultrafast` 가 있다.
- 작업 경로가 git 워크트리면 일꾼마다 워크트리를 따로 준다. 같은 워크트리에 일꾼 둘을 두지 않는다(검사와 편집이 섞인다). 메인 체크아웃에는 쓰기 권한을 주지 않는다.

## 2. 일을 넘기고 결과를 받는다

```sh
herdr agent prompt <이름> "<지시문 파일의 절대 경로> 를 전부 읽고 그대로 일해라."

# 끝 표지나 blocked 를 기다린다. Bash run_in_background 로 건다
until grep -qx 'ECO-DONE' <결과 파일> 2>/dev/null \
   || herdr agent get <이름> | grep -q '"agent_status":"blocked"'; do sleep 10; done
```

- mini 에서는 일하는 동안에도 herdr 상태가 `idle` 이라 `agent prompt --wait` 가 5초 뒤 `agent_prompt_stalled` 로 끝난다. 그래서 완료는 결과 파일의 끝 표지로 판정한다.
- 지시는 **파일로** 준다. 프롬프트에는 그 파일의 경로만 넣는다. 지시문에 넣을 것: 목표, 판단의 기준이 되는 문서의 경로(요약하지 말고 읽게 한다), 손대도 되는 범위, 하지 말 것, 검사 명령과 판정 방법(종료 코드), 결과를 쓸 파일과 형식, "확인하지 않은 것은 확인하지 않았다고 적는다".
- 지시문 끝에 "결과 파일을 다 쓴 뒤 마지막 줄에 `ECO-DONE` 한 줄만 덧붙이고 멈춘다"를 적는다. 표지는 지시문 파일에만 적고 프롬프트 본문에는 넣지 않는다.
- 결과도 **파일로** 받는다. 화면 텍스트로 판정하지 않는다.
- 루프가 끝나면 어느 쪽으로 끝났는지 먼저 본다. `blocked` 면 화면을 읽고 사용자에게 묻는다. 끝 표지면 결과 파일을 읽고 **직접 검증**한다: 바뀐 파일의 diff 를 읽고, 검사 명령을 내가 돌린다. 일꾼이 적은 "통과"를 옮기지 않는다.
- 두 번 연속으로 진행이 없으면 요약 줄을 믿지 말고 화면을 읽는다(`herdr pane read <pane> --lines 20`). 멈춘 사유가 떠 있을 수 있다.
- 일꾼에게 사용자의 승인을 전언으로 옮기지 않는다. 커밋은 일꾼이 해도 되지만 푸시·PR·병합은 오케스트레이터가 사용자 승인 범위 안에서 한다.

### 항목이 여럿이면 일꾼이 서브에이전트를 굴린다

지시문에 항목이 둘 이상이면 탭을 항목 수만큼 늘리지 않는다. 일꾼 탭 하나의 opencode 가 다시 오케스트레이터가 되어, 항목마다 opencode 의 서브에이전트(`subagent` 도구, 기본 제공 에이전트 `general` 등)를 띄워 재현·측정·수정을 맡기게 한다. 지시문에 "일하는 방식" 절을 두고 아래를 적는다.

- 일꾼은 직접 구현을 끌어안지 않는다. 일꾼이 하는 일은 항목별 지시문 작성(항목 본문, 판단의 기준 문서 경로, 손댈 파일 범위, 하지 말 것, 검사 명령, 결과를 쓸 파일 `<결과 폴더>/<항목>.md`), 서브에이전트 결과 검증(diff 를 읽고 검사 명령을 직접 다시 돌린다. 서브에이전트가 적은 "통과"를 옮기지 않는다), 항목 사이의 충돌 관리다.
- 같은 워크트리에서 코드를 고치는 서브에이전트는 동시에 하나만 둔다(검사가 서버 포트와 산출물 폴더를 공유한다). 읽기만 하는 측정은 항목마다 병렬로 띄워도 되고, 임시 파일 이름을 항목별로 다르게 준다.
- 지시문의 "지킬 것"(새 주석 금지, 커밋·push·stash 금지, 종료 코드로 판정, 재현 테스트 먼저)을 서브에이전트에게도 그대로 적어 주게 한다.
- 서브에이전트 도구가 그 세션에 없거나 모델이 인자로 고른 `<모델>` 이 아니면, 그 사실(도구 목록·모델 표시)을 결과 파일 맨 위에 적고 직접 진행하지 말고 멈추게 한다. 모델 비교에서 화면 표시를 `<모델>` 과 글자 그대로 맞추지 않는다. `eco`·`angry` 는 프로바이더 접두사 `opengateway/` 를 뗀 `deepseek/deepseek-v4.1-flash-eco` 와 프로바이더 이름 `OpenGateway` 로 나뉘어 표시되고, `bro` 는 모델 이름 `DeepSeek V4.1 Flash` 로 표시된다.
- 결과 파일에 어떤 서브에이전트가 어떤 항목을 맡았고 몇 번 다시 시켰는지 적게 한다.

이 세션(최상위 오케스트레이터)이 Agent 도구의 서브에이전트를 쓰지 않는다는 규칙은 그대로다. 서브에이전트를 굴리는 쪽은 일꾼인 opencode 다.

## 3. 리뷰 → 조치 루프

1. 일꾼이 한 묶음을 끝내면 결과를 검증하고 커밋을 확정한다.
2. `advisor` 를 부른다. advisor 는 인자가 없고 이 세션의 대화 기록을 본다. 그러므로 부르기 전에 리뷰할 변경을 대화에 올려 둔다: 커밋 범위, 바뀐 파일 목록, 핵심 diff(크면 파일별로 나눠 여러 번 부른다), 판단의 기준 문서 경로. 요청은 "적대적 리뷰, 항목마다 등급(Critical·Major·Minor·Trivial·Info)·파일:줄·재현 시나리오"로 한다.
3. 리뷰 항목을 지시문 파일로 옮겨 일꾼에 넘긴다. 항목마다 **재현부터** 하게 한다: 재현되면 원인을 한 문장으로 적고 같은 원인이 남은 자리를 전수로 찾아 고친다. 재현되지 않으면 측정값을 근거로 무효로 적는다.
4. 고친 뒤 수정분만 대상으로 2로 돌아간다.

**끝나는 조건**: advisor 의 리뷰에서 Critical·Major 가 0건이고, 검사(레포 스크립트의 종료 코드)가 통과한다. 같은 지적이 고친 뒤 다시 나오면 두 번째에는 고치지 말고 멈춰서 사용자에게 묻는다.

## 4. 정리

```sh
herdr pane close <pane id>      # 내가 만든 pane 만 닫는다
```

닫기 전에 일꾼이 띄운 서버·브라우저·임시 워크트리를 일꾼이 정리하게 한다. pane 을 닫아도 그것들은 남는다.

## 실측 (2026-11-17, herdr 0.9.5 · opencode 2.2.0)

- `agent start --kind opencode … -- mini -m deepseek/deepseek-flash` 가 새 탭에서 "Build · DeepSeek V4.1 Flash" 로 떴다.
- "일하는 방식" 절과 끝 표지를 넣은 지시문을 받은 mini 일꾼이 파일마다 `subagent`(general)를 하나씩 띄우고 `wc -l` 로 직접 대조한 뒤, 결과 파일 마지막 줄에 `ECO-DONE` 을 썼다(18초). 그동안 herdr 상태는 계속 `idle` 이었다.
- 결과 파일에 적힌 서브에이전트 세션 셋을 `opencode session export` 로 보니 모두 같은 부모의 자식 세션이고 모델이 `deepseek-flash` 였다.
- `permission` 에서 `"bash": "ask"` 인 경로의 mini 는 권한 대화상자에서 멈췄고, herdr 상태가 `blocked` 로 바뀌었다.
- 같은 경로에서 위 기다리는 루프는 결과 파일 없이 3초 만에 `blocked` 분기로 끝났다.
- 새 pane 의 `CLAUDE_CODE_CHILD_SESSION` 은 비어 있었다.

## 실측 (2026-11-20, herdr · opencode 2.2.0, `opengateway` 프로바이더)

- `-- mini -m opengateway/deepseek/deepseek-v4.1-flash-eco` 와 `… flash-ultrafast` 가 각각 새 탭에서 "Build · deepseek/deepseek-v4.1-flash-eco · OpenGateway", "Build · deepseek/deepseek-v4.1-flash-ultrafast · OpenGateway" 로 떴다.
- 두 모델의 mini 일꾼이 지시문 파일을 읽고 `tirno` 로 외부 사이트를 열어 값을 읽은 뒤, 결과 파일 마지막 줄에 `ECO-DONE` 을 썼다(호출 16회·28회). 이 과정에서 `blocked` 는 없었다.
- 두 모델의 mini 일꾼이 파일 3개 각각에 `subagent`(general)를 하나씩 띄워 줄 수를 구했고, 보고한 값이 126·19·10 으로 `wc -l` 과 일치했다. 자식 세션 3개의 `parentID` 가 부모 세션이고 모델이 부모와 같았으며 `outcome` 이 `succeeded` 였다. 세 자식 세션은 2~3ms 간격으로 생성돼 약 1초 겹쳤다.
- 같은 두 일꾼이 서브에이전트 둘을 한 턴에서 동시에 띄워 서로 다른 파일 두 개를 고치게 했고, 두 파일 모두 지시한 내용이 됐다. 두 일꾼 모두 429·529 는 0회였다. 429 가 나는 동시 요청 수는 재지 않았다.
- `opencode session export` 의 `info.model` 은 `id` 가 `deepseek/deepseek-v4.1-flash-eco`, `providerID` 가 `opengateway` 로 나뉘어 있다.
