# tart-vm

[Tart](https://github.com/openai/tart) 로 띄운 에이전트 전용 macOS VM 을 운용하는 스킬이다. 띄우기·멈추기, `tart exec` 로 게스트 명령 실행, 화면 캡처, 파일 주고받기, 네트워크 모드, 초기화·백업 절차와 실측한 함정을 담는다.

## 설치

```
brew install openai/tools/tart    # tap 이 cirruslabs/cli 에서 openai/tools 로 옮겨졌다
/plugin install tart-vm@plugings
```

## 실측 기준

호스트 macOS 27 · Tart 2.41.1 · 이미지 `ghcr.io/cirruslabs/macos-tahoe-base`(게스트 macOS 26.6.2). 다른 버전에서는 키보드·단축키 관련 항목이 달라질 수 있다.
