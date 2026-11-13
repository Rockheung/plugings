---
name: tart-vm
description: 에이전트 전용 macOS VM(Tart, 예: `agent-mac`)을 띄우고·멈추고·안에서 명령을 실행하고·화면을 보고·파일을 주고받는다. "agent-mac 띄워", "VM 안에서 X 실행", "VM 화면 봐", "tart 로 macOS VM", "VM 초기화/백업", "VM 에 SSH", 게스트 한글 입력·단축키 문제에 사용. Tart CLI 의 실측된 동작과 함정(세션 분리 실행·키보드 옵션·외장 TART_HOME)을 담는다.
---

# tart-vm — 에이전트 전용 macOS VM 운용

실측 기준: 2026-11-13, 호스트 macOS 27(5K 2배율 메인 화면) · Tart 2.41.1 · 이미지 `ghcr.io/cirruslabs/macos-tahoe-base`(게스트 macOS 26.6.2).

## 구성 예 (작성자 환경 — 값은 자기 환경에 맞게)
| 항목 | 값 |
|---|---|
| 설치 | `brew install openai/tools/tart` (tap 은 `openai/tools`, formula 단위 `brew trust` 필요: `tart`·`softnet`) |
| 저장소 | `TART_HOME=/Volumes/tart/tart` (`~/.zshenv`). 외장 USB SSD, APFS, 볼륨명 `tart` |
| VM | `agent-mac` — CPU 4, 메모리 8192MB, 화면 1204×753pt(HiDPI 2408×1506px), `displayRefit` 끔, 디스크 50GB. 메모리·화면은 현행 Mac 중 가장 작은 MacBook Neo(A18 Pro, 8GB, 2408×1506 219ppi)에 맞춤 |
| 계정 | `admin` / `admin` (자동 로그인, 무암호 sudo) |
| 이미지 기본값 | SIP 꺼짐, Gatekeeper 꺼짐, 절전 0, Homebrew 설치됨, SSH·화면 공유·Remote Application Scripting 켜짐, 원격 관리(ARD) 꺼짐 |

외장 디스크가 빠져 있으면 모든 `tart` 명령이 `TART_HOME is invalid` 로 멈춘다. `/Volumes` 가 root 소유라 내장 디스크에 폴더를 만들지 못하므로 이미지가 내장 디스크로 새지 않는다. 먼저 `df -h /Volumes/tart` 로 마운트를 확인한다.

## 띄우기 · 멈추기
```sh
nohup tart run agent-mac --capture-system-keys --no-usb-accessories > /Volumes/tart/tart/agent-mac-run.log 2>&1 &
tart ip agent-mac --wait 120
for i in $(seq 1 30); do timeout 5 tart exec agent-mac true 2>/dev/null && break; sleep 3; done
```
- **반드시 `nohup … &` 로 세션 밖에서 띄운다.** Claude Code 의 `run_in_background` 작업으로 띄우면 메모리 압박 때 Claude Code 가 작업을 죽이고 VM 도 강제 종료된다(게스트 비정상 종료). 띄운 뒤 `ps -o pid,ppid -p <tart PID>` 로 부모가 1 인지 본다.
- **`--no-usb-accessories` 필수.** 빼면 Tart 가 USB 키보드와 Mac 키보드를 둘 다 붙이고(소스 `Platform/Darwin.swift` `keyboards()`), 그 상태에서는 게스트가 두벌식이어도 VM 창 타이핑이 영문으로 들어간다. 이 옵션이면 키보드가 `Virtual Keyboard` 하나만 붙고 한글이 입력된다.
- `--capture-system-keys`: VM 창 포커스 중 Cmd+Tab 등이 게스트로 간다. **Ctrl+Space(입력 소스 전환)는 이 옵션으로도 호스트가 먼저 처리한다**(호스트 입력 소스만 바뀌고 게스트는 그대로, 실측). 게스트 한영 전환은 Caps Lock 전환을 쓴다(게스트 System Settings → Keyboard → Text Input → Edit… → All Input Sources).
- `tart exec` 는 부팅 직후 Guest Agent 가 뜨기 전까지 `is the Tart Guest Agent running?` 으로 실패한다. 위 루프로 기다린다.
- 멈추기: `tart stop agent-mac` (정상 종료). CPU·메모리·화면 설정 변경은 꺼진 상태에서만: `tart set agent-mac --memory 8192`.
- 실행 중 외장 디스크를 뽑으면 게스트 디스크가 깨질 수 있다. 꺼져 있을 때는 그냥 뽑아도 된다(볼륨의 Spotlight·fseventsd 끔).

## 게스트에서 명령 실행
| 방법 | 세션 | 특징 |
|---|---|---|
| `tart exec agent-mac <cmd>` | `Aqua`(GUI 세션), 사용자 `admin` | 네트워크 무관(virtio-vsock+gRPC), 인증 없음, `tart run` 이 떠 있어야 함 |
| `ssh admin@$(tart ip agent-mac)` | `Background` | 호스트에서만 접속 가능(NAT) |

`tart exec` 실측 동작:
- 종료 코드가 그대로 전달된다(`exit 3` → 호스트 `$?=3`).
- stdin 은 **`-i` 를 줘야** 전달된다. 없으면 조용히 버려진다.
- stdout·stderr 는 각각 호스트 stdout·stderr 로 온다. 바이너리도 깨지지 않는다(sha256 일치) → 파일 꺼내기: `tart exec agent-mac cat /path > local`, 넣기: `tart exec -i agent-mac sh -c 'cat > /path' < local`.
- cwd `/Users/admin`, PATH 에 `/opt/homebrew/bin` 포함. 셸 해석이 필요하면 `sh -c '…'` 로 감싼다.
- 입력 소스 API(TIS)처럼 GUI 세션이 필요한 작업은 `tart exec` 로 한다. GUI 앱 실행(`open -a …`)은 exec·SSH 둘 다 됐다.

## 화면 보기
- 게스트 안 캡처: `tart exec agent-mac screencapture -x /tmp/s.png` 후 위 방법으로 꺼낸다. 창 내용까지 찍힌다(게스트 픽셀 그대로, 1204×753pt 면 2408×1506, 권한 창 없음).
- 사람이 조작: 화면 공유 `open vnc://$(tart ip agent-mac)` (admin/admin). 한글·단축키는 화면 공유 쪽이 잘 된다.
- VM 창 위치: `osascript -e 'tell application "System Events" to get {position, size} of window 1 of (first process whose unix id is <tart PID>)'` → 호스트 `screencapture -x -R x,y,w,h`.

### 화면 해상도 바꾸기
- `--display WxHpt` 의 pt 는 **호스트 메인 화면 배율**을 따른다(소스 `Platform/Darwin.swift` `graphicsDevice()`: `VZMacGraphicsDisplayConfiguration(for: NSScreen.main, sizeInPoints:)`). 2배율 호스트면 HiDPI 로 그려진다. `px` 는 72ppi 1배율.
- **`tart set --display` 만으로는 게스트 화면이 안 바뀐다.** 게스트가 고를 수 있는 모드 목록에 그 크기가 추가될 뿐이고, 게스트 macOS 는 전에 쓰던 모드를 유지한다. 게스트 안에서 모드를 영구 적용한다(재부팅 뒤 유지, 실측):
  ```sh
  tart exec agent-mac sh -c 'cat > /tmp/setmode.swift <<EOF
  import CoreGraphics
  let d = CGMainDisplayID()
  let opts = [kCGDisplayShowDuplicateLowResolutionModes: true] as CFDictionary
  let m = (CGDisplayCopyAllDisplayModes(d, opts) as! [CGDisplayMode]).first { \$0.width == 1204 && \$0.height == 753 && \$0.pixelWidth == 2408 }!
  var cfg: CGDisplayConfigRef?
  CGBeginDisplayConfiguration(&cfg)
  CGConfigureDisplayWithDisplayMode(cfg, d, m, nil)
  print(CGCompleteDisplayConfiguration(cfg, .permanently).rawValue)
  EOF
  swift /tmp/setmode.swift'
  ```
  `0` 이 나오면 성공. 확인은 게스트 `screencapture` 결과 픽셀 크기로.
- `displayRefit`(기본 켜짐)은 VM 창 크기에 맞춰 게스트 해상도를 바꾼다. 고정 해상도가 필요하면 `tart set agent-mac --no-display-refit`.
- refit 을 끄면 VM 창 비율이 화면과 다를 때 레터박스가 생긴다. 창 크기를 `{폭, 높이+28}`(제목 막대 28pt)로 맞추면 꽉 찬다: `osascript -e 'tell application "System Events" to tell window 1 of (first process whose unix id is <tart PID>) to set size to {1204, 781}'`.

## 네트워크
기본 NAT(`VZNATNetworkDeviceAttachment`): 게스트 192.168.64.x, 게이트웨이·DNS 는 호스트 `bridge100`(192.168.64.1). 나가는 트래픽은 호스트 연결(VPN 포함)을 따른다. 같은 LAN 의 다른 기기는 게스트에 못 붙는다.
- 호스트의 `/etc/resolver` split-DNS 가 게스트에도 그대로 적용된다. 게스트 `scutil --dns` 에는 `192.168.64.1` 하나만 보이지만, 호스트가 그 질의를 자기 리졸버 규칙으로 풀어 준다. 사내 도메인 7개 존의 호스트 10개를 호스트·게스트에서 `dscacheutil -q host` 로 조회한 결과와 TCP 접속 3건이 모두 같았다(호스트에서 안 풀리는 이름은 게스트에서도 안 풀림).
- `--net-bridged=en0`: LAN 에 직접 붙음. `--net-softnet` + `--net-softnet-allow/block/expose`: 대역 제한·포트 노출. `--net-host`: 호스트하고만 통신.

## 초기화 · 백업
- 손대지 않은 상태로 되돌리기: `tart delete agent-mac && tart clone ghcr.io/cirruslabs/macos-tahoe-base@sha256:65c3133a633fda8753cf1f71f2d55727792d534a2125b0032466563dcc8e58fd agent-mac && tart set agent-mac --cpu 4 --memory 8192 --display 1204x753pt --no-display-refit`. digest 로 지정하면 캐시에서 바로 clone 한다(재다운로드 없음). `tart delete` 는 되돌릴 수 없으니 승인을 받는다. 띄운 뒤 위 "화면 해상도 바꾸기" 의 게스트 모드 적용까지 해야 초기값이 맞는다.
- 백업: `tart clone agent-mac agent-mac-backup` — 같은 APFS 볼륨이라 블록을 공유해 처음엔 공간을 거의 안 쓴다. 디스크 자체 고장은 못 막으므로 그 대비는 `tart export` 를 다른 디스크에.

## 측정하지 않은 것
- Tart VM 창을 닫거나(`--no-graphics`) 최소화한 상태에서 게스트의 headed 브라우저·CDP 가 정상 동작하는지.
- `--capture-system-keys` 없이 VM 창에서 Caps Lock 한영 전환이 되는지.
- VM 을 재시작했을 때 Tart 가 창을 맞춘 크기로 다시 여는지.

## 함께 쓰는 자원
다른 VM(colima 등)과 메모리를 나눠 쓴다. 띄우기 전 `memory_pressure | tail -1` 과 `sysctl -n vm.swapusage` 로 여유를 본다.
