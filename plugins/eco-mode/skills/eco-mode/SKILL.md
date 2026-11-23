---
name: eco-mode
description: 이 세션이 오케스트레이터가 되어 구현·조사·수정을 herdr 새 탭의 opencode(모델은 인자로 고른다: bro · eco · angry)에 맡기고, 적대적 리뷰는 advisor 에 맡기는 작업 방식. "eco-mode 로 해", "deepseek flash 에 맡겨", "오케스트레이터로 진행해" 라고 하거나, Agent 도구의 서브에이전트를 띄우려 할 때 대신 쓴다. 탭을 띄워 모델을 고정하는 명령, 일을 넘기고 결과를 받는 루프, 리뷰→조치 반복의 종료 조건을 담는다.
---

# eco-mode

진행하는 세션은 **오케스트레이터**다. 직접 구현하지 않고 세 가지를 한다.

| 일 | 맡는 쪽 |
|---|---|
| 구현·조사·재현·수정 | herdr 로 현재 workspace 의 새 탭에 띄운 opencode, 모델은 아래 "인자" 표로 고른다. 일꾼은 서브에이전트를 쓰지 않고 직접 처리한다 |
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

- **429·529 대처:** 일꾼 지시문에 아래 절차를 그대로 넣는다.
  - 오류를 `error.code` 로 가른다. `concurrency_limit_exceeded`(HTTP 429)는 동시 요청이 많다는 뜻이고, `overloaded`(HTTP 529)는 서비스의 일시 과부하다. 둘 다 재시도 대상이다. `budget_exceeded`(HTTP 429)는 키의 금액 한도 초과라 재시도해도 풀리지 않으므로, 재시도하지 않고 멈춰서 결과 파일 맨 위에 적는다.
  - 재시도 전에 응답의 `Retry-After` 초만큼 기다린다. 고정 간격으로 가정하지 않는다.
  - 같은 요청을 최대 3번 다시 시도한다. 3번 뒤에도 실패하면 멈추고, 결과 파일 맨 위에 상태 코드, `error.code`, 마지막 `Retry-After`, 줄인 병렬 수를 적는다.
  - 한도를 올려야 하면 OpenGateway 지원팀에 요청한다. 오케스트레이터는 일꾼 대신 재시도하거나 모델을 바꾸지 않고, 결과 파일을 읽고 사용자에게 보고한다.
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

### 일꾼은 서브에이전트 없이 직접 처리한다

일꾼 opencode 는 `subagent` 도구로 서브에이전트를 띄우지 않고 지시문의 항목을 직접 처리한다. 지시문에 "서브에이전트를 쓰지 않는다"를 적는다(opencode 는 시키지 않으면 서브에이전트를 쓰지 않지만, 항목이 여럿이면 스스로 나눠 띄우는 일이 있다).

- 항목이 여럿이면 한 워크트리에서 항목마다 커밋하며 순서대로 처리하게 한다.
- 서로 독립인 묶음을 동시에 돌려야 하면 묶음마다 워크트리와 일꾼 탭을 따로 둔다. 같은 워크트리에 일꾼 둘을 두지 않는다. 끝난 일꾼의 pane 은 바로 닫는다.
- 결과 파일에 항목마다 처리 결과를 적게 한다.

이 세션(최상위 오케스트레이터)이 Agent 도구의 서브에이전트를 쓰지 않는다는 규칙도 그대로다.

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
- 끝 표지를 넣은 지시문을 받은 mini 일꾼이 결과 파일 마지막 줄에 `ECO-DONE` 을 썼다. 그동안 herdr 상태는 계속 `idle` 이었다.
- `permission` 에서 `"bash": "ask"` 인 경로의 mini 는 권한 대화상자에서 멈췄고, herdr 상태가 `blocked` 로 바뀌었다.
- 같은 경로에서 위 기다리는 루프는 결과 파일 없이 3초 만에 `blocked` 분기로 끝났다.
- 새 pane 의 `CLAUDE_CODE_CHILD_SESSION` 은 비어 있었다.

## 실측 (2026-11-20, herdr · opencode 2.2.0, `opengateway` 프로바이더)

- `-- mini -m opengateway/deepseek/deepseek-v4.1-flash-eco` 와 `… flash-ultrafast` 가 각각 새 탭에서 "Build · deepseek/deepseek-v4.1-flash-eco · OpenGateway", "Build · deepseek/deepseek-v4.1-flash-ultrafast · OpenGateway" 로 떴다.
- 두 모델의 mini 일꾼이 지시문 파일을 읽고 `tirno` 로 외부 사이트를 열어 값을 읽은 뒤, 결과 파일 마지막 줄에 `ECO-DONE` 을 썼다(호출 16회·28회). 이 과정에서 `blocked` 는 없었다.
- `opencode session export` 의 `info.model` 은 `id` 가 `deepseek/deepseek-v4.1-flash-eco`, `providerID` 가 `opengateway` 로 나뉘어 있다.
