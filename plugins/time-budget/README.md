# time-budget

> Claude에겐 경과 시간을 감지하는 패시브 센서가 없다. "시간을 느껴라"는 지킬 수 없는 지시다.
> 대신 **능동 조회**(date 프로브)와 **백그라운드 알람**(트립와이어)으로 바꾸고,
> 타이머가 못 잡는 부분은 **시간 프록시 규율**(왕복·빈턴·출력량·우회 최소화)로 관리한다.

---

## 되는 것 (검증됨)

| 메커니즘 | 방법 |
|---|---|
| 능동 시간 프로브 | `clock.sh start <label>` / `clock.sh elapsed <label>` — epoch 파일 기반, 초 단위 |
| 백그라운드 트립와이어 | `sleep N; echo "TRIPWIRE ..."` 를 `run_in_background`로 실행 → 완료 시 하니스가 재호출(`<task-notification>`)하는 걸 알람으로 이용 |
| 장기 작업 | 블로킹 대신 `run_in_background` → 완료 시 종료코드와 함께 통지 |

## 안 되는 것 (한계 — 정직하게 구분)

- **턴 내부의 자기 생성은 어떤 타이머로도 중간에 못 끊는다.** 폭주 생성이 시작되면 멈출 수 없음.
- 알람/트립와이어는 **턴 사이 / 도구 완료 시에만** 울린다 — 만능 타이머가 아님.
- **워치독 서브에이전트는 비추천** — 서브에이전트도 시계가 없고 Claude 내부 상태를 못 봄. 결국 `sleep N`과 동급이면서 더 비쌈.

## 시간 프록시 최소화 (타이머가 못 잡는 부분)

사용자 체감시간과 직결되는, 행동 전에 셀 수 있는 지표들:

- **왕복 횟수** — 독립 호출은 한 메시지에 병렬로
- **빈 턴 = 0** — 선언과 tool call을 같은 메시지에
- **출력량** — base64 벽·장문 회고 생성 금지
- **우회 단계** — 없는 문제를 위한 파이프라인 발명 금지, 사용자가 지름길을 주면 즉시 그 길로

## 절차

1. `clock.sh start <task>` — T0 stamp
2. 예산 잡기: 왕복 N회 예상, 외부 장기작업엔 트립와이어 `sleep <budget>` 백그라운드로
3. 결정 지점마다 `clock.sh elapsed <task>` 로 경과 확인, 예산 초과 시 접근 전환
4. 종료 시 트립와이어 정리(`TaskStop`)

## 구성

```
time-budget/
├── .claude-plugin/plugin.json
├── skills/time-budget/
│   ├── SKILL.md      # 절차 + 메커니즘 + 한계
│   └── clock.sh       # POSIX sh 헬퍼 — start/elapsed, $TMPDIR/claude-clock/<label> 기반
└── README.md
```
