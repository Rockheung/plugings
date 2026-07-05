# rectify

> 세션 자기교정 — 이 세션의 행위를 **CLAUDE.md 규칙(오라클)** 과 대조해 위반·잘된 패턴을 가려내고
> **Lessons Learned** 에 기록·유지한다. lore 의 구조(lead·worker·keeper)를 자기-심리(審理)에 적용.

---

## 세 인격 (자기 심리 법정)

```
Magistrate  → 주재한다   (lead   — 궤적·아티팩트 수집 + 심리 분배 + 종합·보고)
Examiner    → 따진다     (worker — 규칙 카테고리별 적대적 감사, 세션과 분리)
Chronicler  → 남기고 지킨다 (keeper — 교훈 기록 + 주기 재검증·은퇴)
```

| 에이전트 | 역할 | 쓰기 | lore 대응 |
|---|---|---|---|
| **magistrate** | 증거 수집 → Examiner 병렬 dispatch → 종합 → 보고 → (승인 후) Chronicler 위임 | 승인 후만 | Archivist(lead) |
| **examiner** | 배정된 한 규칙 카테고리를 **ego 없이 적대적**으로 감사, 증거 기반 판정 | read-only | Scout(worker) |
| **chronicler** | 위반을 scope 와 함께 Lessons 에 기록(모든 세션 로드 → 어디서든 회수) + **기존 교훈 수명 재검증**(은퇴/scope축소). 기록처: **`$RECTIFY_LESSONS` > 기존 `## Lessons Learned`(CLAUDE.md 의 `@import` 대상 파일까지 추적) > user-global `~/.claude/CLAUDE.md` 새 섹션**. 프로젝트 한정 교훈만 그 프로젝트 CLAUDE.md | Lessons 만(승인 후) | Curator |

## 두 모드

- **사후(post-mortem)** — 기본. `magistrate` 에 위임 → 세션 종료/현재 시점에 증거 기반 확정 심리.
- **라이브(watch)** — `rectify-watch` 스킬: 세션 transcript 를 tail 하며 규칙 위반을 **즉시 조기경보**. 예방쪽(confirm-gate 류). 감사 렌즈가 CLAUDE.md 규칙으로 고정된 자립형 감시 — tail·렌즈·종료를 스스로 수행한다.

## 왜 이 구조인가 (연구 근거)

순수 자기교정은 약하다 — LLM 은 외부 피드백 없이 자기 답을 고치면 **정확도가 되레 떨어진다**(self-bias·과신). 자기교정은 **오라클·외부검증이 있을 때** 작동한다. 그래서 rectify 는:
- **오라클**: CLAUDE.md 규칙(ground-truth 레퍼런스) — 열린 추론 교정이 아니라 *명시 규칙 대조*.
- **외부검증**: Examiner 를 **세션과 분리**(ego 없는 제3자) + **적대적**(default-suspicious) + **병렬 다관점**.
- **증거 기반**: 인상 회고가 아니라 `git`/`gh pr`/file-history/transcript 아티팩트.
- **성공도 추출**(ExpeL): 실패만이 아니라 잘 지킨 패턴도 학습.
- **교훈 수명관리**(Reflexion 메모리 + 자기강화 오류 방어): scope 명시 + 주기 재검증으로 낡거나 과일반화된 교훈을 은퇴.

참조: LLMs Cannot Self-Correct Reasoning Yet / Reflexion / ExpeL / Self-Correct w/ Key Condition Verification.

## 설치 / 쓰는 법

```text
/plugin marketplace add Rockheung/plugings
/plugin install rectify@plugings
```

```
# 사후 자기교정 (이 세션)
"magistrate 로 이번 세션을 CLAUDE.md 규칙과 대조해 점검해"

# 라이브 감사 (다른 세션/현재 세션 감시)
/rectify-watch ~/work             # 그 세션 tail + 규칙 위반 조기경보

# 교훈 수명 재검증만
"chronicler 로 Lessons Learned 가 아직 유효한지 재검증해"
```

> **오케스트레이션 주의**: Magistrate 가 Examiner 를 병렬로 띄우는 건 서브에이전트 중첩 스폰을 전제. 런타임이 제한하면, Magistrate 분해를 메인 세션이 받아 Examiner 들을 순차 실행.

## 구조

```
rectify/
├── .claude-plugin/plugin.json
├── agents/
│   ├── magistrate.md   # lead: 수집 + 심리 분배 + 종합·보고
│   ├── examiner.md     # worker: 규칙 카테고리별 적대적 감사 (read-only)
│   └── chronicler.md   # keeper: Lessons 기록 + 수명 재검증
├── skills/
│   └── rectify-watch/  # 라이브 감사 (자립형 tail + CLAUDE.md audit 렌즈)
└── README.md
```

## lore 와의 관계

rectify = **lore 패턴을 "에이전트 자기 행위" 도메인에 인스턴스화**한 것. lore(코드→지식)와 코드는 공유하지 않지만 루프가 동형: 수집(Scout↔Magistrate-gather) → 분리·적대 검증(verify↔Examiner) → 기록(Archivist↔Chronicler) → 주기 재검증(Curator↔Chronicler 2단계).
