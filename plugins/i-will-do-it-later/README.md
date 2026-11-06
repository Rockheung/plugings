# i-will-do-it-later

일을 멈추자는 말을 꺼낸 세션을 끝내는 스킬이다. "내일 할까?", "오늘은 여기까지 할까?", "이만 마칠까?" 를 출력하려 할 때 묻는 대신 미룰 일을 기록하고 정리한 뒤 세션을 종료한다.

## 설치

[herdr](https://herdr.dev) pane 안에서 도는 세션과 [bun](https://bun.sh) 이 필요하다. 바이너리와 허용 규칙은 사용자가 직접 만든다. 세션이 스스로 만들면 auto 모드 분류기가 `Tmux Self Drive` 사유로 거부한다.

```sh
bun build --compile <플러그인 경로>/skills/i-will-do-it-later/i-will-do-it-later.ts --outfile ~/.local/bin/i-will-do-it-later
```

`/permissions` 의 Allow 에 규칙을 넣는다.

```
Bash(~/.local/bin/i-will-do-it-later)
```

## 한계

- 세션이 턴 도중에 끝나므로 마지막 턴의 응답은 대화 기록에 남지 않을 수 있다.
- 모델이 멈추자는 말을 출력하기 전에 알아채야 동작한다. 놓치면 아무 일도 일어나지 않는다.
