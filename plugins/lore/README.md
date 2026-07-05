# lore

> 미지/레거시 코드베이스를 **규율 있는 탐색**으로 학습해 **자가유지 지식베이스**를 쌓는 3-에이전트 묶음.
> 발견 → 기록 → 검증 → 재발견 루프.

---

## 세 인격

```
Scout      → 찾아온다   (Discovery)
Archivist  → 남긴다     (Knowledge — 지휘 + 종합 + 기록)
Curator    → 지킨다     (Validation — 기록된 지식 주기 재검증)
```

| 에이전트 | 역할 | KB 접근 | 띄우는 법 |
|---|---|---|---|
| **scout** | scoped 발견 — 엔트리포인트/API추적/의존성/호출그래프/게이팅. 하나당 질문 하나, 병렬로 다수 | read-only | Archivist 가 병렬 dispatch (또는 직접) |
| **archivist** | 넓은 질문을 Scout 미션들로 분해·지휘 → 종합 → **KB 에 기록**. 커버리지 마를 때까지 반복 | **write** | 메인 세션이 위임 |
| **curator** | **이미 기록된 지식을 주기적으로 재검증** — 현 코드와 대조해 verified/stale/contradicted 갱신, drift 시 재탐색 권고 | read + status 갱신 | 정기 실행 / "KB 검증해라" |

## 루프

```
        ┌──────────── Scout (발견) ────────────┐
        │                                       ▼
   (재탐색 씨앗)                          Archivist (종합·기록)
        ▲                                       │
        │                                       ▼
        └──────── Curator (주기 재검증) ◀─── 지식베이스(KB)
                  drift 발견 → 재탐색 권고
```

Scout 가 찾고, Archivist 가 남기고, 시간이 지나 코드가 변하면 Curator 가 어긋남을 잡아 재탐색을 부른다 — 지식이 **썩지 않고 갱신되는** 구조.

## 설계 근거 (정립된 패턴 대조)

- **Orchestrator-worker** (Anthropic Research: lead + 3–5 병렬 subagent + 반복 종합 + 별도 CitationAgent) = Archivist(lead) + Scout(worker) + Archivist 의 기록 전 **귀속 검증 게이트**.
- **Coordinator–Implementor–Verifier** = Curator 가 검증 루프를 닫음.
- **Self-updating KB** (Fini/Meta/Guru: 소스 변경·사실 충돌 신호로 재검증, 삭제 대신 flag) = Curator 의 **VCS-트리거 + 충돌 탐지 + 비파괴 표시**.
- 미션 명세 4요소·effort 스케일링·실패모드 가드는 Anthropic 의 멀티에이전트 교훈에서.

## 언제 쓰지 말 것 (비용·한계)

멀티에이전트 fan-out 은 **토큰을 크게 쓴다(단일 대비 수배~십수배)**. **분할 가능한 탐색·매핑**(미지 코드베이스 이해, 후보 경로 survey)엔 강하지만, **긴밀히 얽힌 단일 추론**(예: 코딩 그 자체, 한 함수 디버깅)엔 부적합 — 그땐 Scout 하나 또는 메인 세션이 직접. 한 건짜리 질문에 함대를 띄우지 마라.

## 왜 기존 Explore/general-purpose 와 다른가

- **Explore** = read-only 팬아웃 검색, 일회성 결론.
- **lore** = ① 탐색 규율(싼 것 먼저 / "코드 위치 ≠ 검증 위치" / 토끼굴 2-스트라이크 / 사실·추론 라벨)을 강제하고 ② 결과가 **KB 에 누적**되어 다음 탐색이 싸지고 ③ Curator 가 지식의 **시간적 무결성**을 지킨다. 한 번 찾고 끝이 아니라 **공부가 쌓이는** 시스템.

## 경계 — 도구 운영 에이전트와의 결

도구 운영 에이전트(어떤 도구를 *부리는* 역할)도 무언가를 기록한다. 결이 다르다:

| | 도구 운영 에이전트 | lore |
|---|---|---|
| 무엇에 대한 앎 | **도구를 *어떻게 부리는가*(HOW)** — cert·envoy·profile·dev-env 재현 함정 | **대상 코드가 *무엇인가*(WHAT)** — 데이터흐름·호출그래프 |
| 앵커 | 도구 명령·환경 | `{file}:심볼` |
| 수명관리 | lessons / work-log (도구 진화 따라 append) | Curator 가 현 코드와 대조해 verified/stale/contradicted |
| 범위 | 그 도구에 종속 | 도구-무관, 대상 레포에 특정 |

같은 사건도 **층이 다른 두 기록**을 낳는다(중복 아님): 코드가 무엇인지는 lore, 도구를 어떻게 부리는지는 그 도구 에이전트.

**핸드오프**: 도구 에이전트가 *코드 사실(WHAT)* 을 기록하려 할 때 lore 가 설치돼 있으면, 직접 적지 말고 **메인 세션 경유로 archivist 에 넘긴다**(sub-agent→sub-agent 직접 위임은 막힐 수 있어 *핸드오프를 surface*). 넘겨받은 단서(파일·라인)는 **seed 일 뿐 — lore 가 코드로 재검증**해 자기 KB 에 기록한다. 이로써 도구 에이전트의 미검증 주장이 KB 에 사실로 굳는 걸 막는다(검증 게이트). lore 부재 시에만 도구 에이전트가 최소 기록.

## 지식베이스(KB)

lore 는 특정 지식 레포에 묶이지 않는다. KB 규약(아래)을 에이전트 본문에 내장하되, **cuneiform-tablet 형식 스킬이 설치돼 있으면 그걸 우선**(부재 시 내장 규약으로 폴백).

**KB 루트 해석 (순서):**
1. 미션이 준 경로
2. `$LORE_KB`
3. git repo 안이면 `<repo>/docs/knowledge/`
4. `~/.lore/knowledge/` — **버전-무관 영속 (미지정 시 기본 저장소)**

**규약** (한 개념 = 한 markdown):
- frontmatter `created/updated/status`(active|draft|deprecated|dormant), `_index.md` 가 TOC. (`dormant` = Curator 가 은퇴 강등한 cold 노트 — 기본 스윕 제외, 가역.)
- **`verified_at`**: 이 노트가 검증된 *소스 레포*(코드가 사는 곳 — KB 레포 아님) HEAD 의
  short-SHA. Archivist 가 기록 시 박고, Curator 가 재검증 통과 시 새 HEAD 로 갱신. 코드
  도메인의 시간 앵커(날짜보다 정확) — Curator 가 `git diff <verified_at>..HEAD` 로 인용
  심볼이 그 SHA 이후 실제 바뀌었는지만 보고 stale 판정(코드 안 변하면 지식도 안 썩는다).
  멀티-repo `_shared` 노트는 맵 `verified_at: {repo: sha, ...}`.
- 멀티-repo KB 면 스코프 `{repo}` / `{repo}/{sub-path}` / `_shared`(`repos:` 태그) / `_domain`; 단일 KB 면 평면.
- 90일+ stale / 200줄+ 분할 / 출처 `{file}:심볼` 인용.
- **노트간 엣지 `[[slug]]`** (Zettelkasten): 본문에서 관련 노트를 `[[note-slug]]` 로 링크,
  관계 타입을 붙이면 `[[slug|uses]]` / `[[slug|calls]]` / `[[slug|decided-by]]` /
  `[[slug|supersedes]]` / `[[slug|see-also]]`. 이게 KB 를 **그래프**로 만든다 — Recall 이
  키워드 평면검색이 아니라 **시드 → 엣지 순회**로 관련 이웃을 끌어오고, "왜 X?"를
  `decided-by` 엣지로 답한다. (`_index.md` 는 TOC, `[[ ]]` 는 노트간 관계 — 별개 층.)
- **현재 사실만**(계획/TODO/**해결책·제안 금지** — `[infer]` 라벨도 예외 아님; `[infer]` 는 현재 코드 추론 전용), 비파괴 갱신.

| lore 단계 | 호환 스킬(있으면 우선) |
|---|---|
| Scout 의 **Recall** | `tablet-read` 류 |
| Archivist 의 **Record** | `tablet-write` 류 |
| Curator 의 **검증** | `tablet-audit` 류 (+ lore 고유: 본문 사실을 현 코드와 재검증) |

> ⚠️ KB 를 `${CLAUDE_PLUGIN_ROOT}/data/` 에 두지 마라 — 그건 **해시 버저닝된 플러그인 캐시**(`cache/<sha>/`)라 업데이트 시 새 SHA 로 옮겨가 **고아**가 된다(예전 "영속 data" 표기는 오류). 영속 기본값은 `~/.lore/knowledge/`. 추가 내구성은 `lore-backup`(`~/.lore/backups`) + `lore-restore`.

## 설치

```text
/plugin marketplace add Rockheung/plugings
/plugin install lore@plugings
```

## 쓰는 법

```
# 넓은 학습/매핑 — Archivist 에 위임 (Scout 들 자동 지휘 → KB 기록)
"archivist 로 이 레포의 결제 흐름을 매핑해서 KB 에 정리해줘"

# 좁은 한 건 — Scout 직접
"scout 로 결제 페이지가 어느 템플릿·서비스로 렌더되는지 추적"

# 주기 검증 — Curator (무결성 감사 + 사실 재검증)
"curator 로 KB 항목들을 현재 코드와 재검증"

# 백업 / 복원 (플러그인 재설치 대비)
/lore-backup            # KB → ~/.lore/backups/lore-kb-<ts>.tar.gz
/lore-restore --list    # 백업 목록
/lore-restore           # 최신 백업으로 복원
```

> **오케스트레이션 주의**: Archivist 가 Scout 를 병렬로 띄우는 건 서브에이전트 중첩 스폰을 전제한다. 런타임이 중첩 스폰을 제한하면, Archivist 의 분해 결과를 메인 세션이 받아 Scout 들을 띄우고 종합을 Archivist 에 넘기는 식으로 운용한다. Curator 의 주기 실행은 cron/스케줄러로 거는 것을 권장.

## 구조

```
lore/
├── .claude-plugin/plugin.json
├── agents/
│   ├── scout.md       # 발견 (read-only, 병렬 다수)
│   ├── archivist.md   # 지휘 + 종합 + KB 기록
│   └── curator.md     # 기록된 지식 주기 재검증
├── skills/
│   ├── lore-backup/   # KB → 내구성 백업(tar.gz, 로테이션)
│   └── lore-restore/  # 백업에서 KB 복원(비파괴 기본)
└── README.md
```
