# i-will-do-it-later

일을 멈추자는 말을 꺼낸 세션을 끝내는 스킬이다. "내일 할까?", "오늘은 여기까지 할까?", "이만 마칠까?" 를 출력하려 할 때 묻는 대신 미룰 일을 기록하고 정리한 뒤 세션을 종료한다.

## 설치

[herdr](https://herdr.dev) pane 안에서 도는 세션이 필요하다. 바이너리는 `skills/i-will-do-it-later/bin/` 에 `darwin-arm64`·`darwin-x64`·`linux-arm64`·`linux-x64` 로 들어 있다. 다시 빌드할 때는 `bun build --compile --target=bun-<os>-<arch>` 를 쓴다.

허용 규칙은 사용자가 직접 넣는다. 규칙이 없으면 auto 모드 분류기가 `Tmux Self Drive` 사유로 거부한다. `/permissions` 의 Allow 에 쓰는 플랫폼의 경로를 넣는다.

```
Bash(~/.claude/plugins/cache/plugings/i-will-do-it-later/1.0.0/skills/i-will-do-it-later/bin/i-will-do-it-later-darwin-arm64)
```

## 한계

- 세션이 턴 도중에 끝나므로 마지막 턴의 응답은 대화 기록에 남지 않을 수 있다.
- 모델이 멈추자는 말을 출력하기 전에 알아채야 동작한다. 놓치면 아무 일도 일어나지 않는다.
