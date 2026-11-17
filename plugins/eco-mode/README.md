# eco-mode

이 세션을 오케스트레이터로 두고, 구현·조사·수정은 herdr 새 탭의 opencode mini(deepseek flash)에, 적대적 리뷰는 `advisor` 에 맡기는 작업 방식을 담은 스킬이다. 일꾼을 띄우는 명령, 지시문·결과 파일로 일을 주고받는 루프, 일꾼이 항목마다 서브에이전트를 띄우게 하는 지시문 절, 리뷰→조치 반복의 종료 조건을 담는다.

## 설치

```
/plugin install eco-mode@plugings
```

herdr 조작의 일반 절차는 `session-delegation` 플러그인에 있다.

## 실측 기준

herdr 0.9.5 · opencode 2.2.0 · 모델 `deepseek/deepseek-flash`.
