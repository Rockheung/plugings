// node --test plugins/figma-cli/tests/
//
// 네트워크를 타지 않는 순수 함수만 잠근다 — Figma 앱이 없는 CI 에서도 돌아야 한다.
// 고정 입력은 실제 서버 응답에서 잘라 온 것이다(2026-09-09, [DM] Widget Studio).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { parseNodeId, parseSse, parseMetadata, renderTree, findNodes, parseArgs }
  from '../skills/figma/scripts/fig.mjs'

describe('parseNodeId — URL 을 그대로 붙여넣어도 받는다', () => {
  test('URL 의 node-id 는 하이픈이라 콜론으로 정규화한다', () => {
    assert.equal(
      parseNodeId('https://www.figma.com/design/ZsugR6FJKIGjbKBv7DLdiZ/-DM--Widget-Studio?node-id=7327-61763&m=dev'),
      '7327:61763')
  })
  test('node-id 가 뒤쪽 파라미터여도 찾는다', () => {
    assert.equal(parseNodeId('https://figma.com/design/k/f?m=dev&node-id=1-2&t=abc'), '1:2')
  })
  test('퍼센트 인코딩된 콜론도 푼다', () => {
    assert.equal(parseNodeId('https://figma.com/design/k/f?node-id=1%3A2'), '1:2')
  })
  test('맨 id 는 두 형식 다 받는다', () => {
    assert.equal(parseNodeId('7327-61763'), '7327:61763')
    assert.equal(parseNodeId('7327:61763'), '7327:61763')
  })
  test('생략은 null — 서버가 현재 선택 노드를 쓴다', () => {
    assert.equal(parseNodeId(undefined), null)
    assert.equal(parseNodeId(''), null)
  })
  test('node-id 없는 URL 은 조용히 통과시키지 않는다', () => {
    assert.throws(() => parseNodeId('https://figma.com/design/abc/File'), /노드 id/)
  })
})

describe('parseSse — 응답은 event-stream 이라 data 줄만 이어 붙인다', () => {
  test('data 줄 하나', () => {
    assert.deepEqual(parseSse('event: message\ndata: {"result":{"ok":true}}\n\n'), { result: { ok: true } })
  })
  test('data 줄 여럿은 이어 붙여야 JSON 하나가 된다', () => {
    assert.deepEqual(parseSse('event: message\ndata: {"a":\ndata: 1}\n'), { a: 1 })
  })
  test('SSE 가 아니면 본문 그대로 JSON 으로 읽는다 (404 등)', () => {
    assert.equal(parseSse('{"error":{"code":-32002}}').error.code, -32002)
  })
})

// 실제 응답에서 잘라 온 조각: 캔버스 이름의 선행 공백, 엔티티(&gt;), hidden, 중첩.
const XML = `<document id="0:0" name="Document" x="0" y="0" width="0" height="0">
  <canvas id="7214:58559" name="⚪️  진행중" x="0" y="0" width="0" height="0" />
  <canvas id="6853:56204" name="     ↪︎ 디자인 모드 -&gt; 커스텀 위젯" x="0" y="0" width="0" height="0">
    <frame id="5202:50994" name="screen" x="-6965" y="3943" width="1920" height="1080">
      <instance id="7327:61763" name=".modalHeader" x="0" y="0" width="780" height="54">
        <frame id="I7327:61763;5979:68627" name="Horizontal Tab" x="8" y="6" width="411" height="48" />
      </instance>
      <instance id="5202:50995" name="leadingtButton" x="1480" y="28" width="64" height="40" hidden="true" />
    </frame>
  </canvas>
  <canvas id="0:2" name="Internal Only Canvas" x="0" y="0" width="0" height="0" hidden="true" />
</document>`

const nodes = parseMetadata(XML)
const byId = (id) => nodes.find((n) => n.id === id)

describe('parseMetadata — 한 줄에 요소 하나, 들여쓰기 2칸이 깊이다', () => {
  test('닫는 태그는 노드가 아니다', () => {
    assert.equal(nodes.length, 8)
  })
  test('속성을 숫자로 읽는다', () => {
    const n = byId('7327:61763')
    assert.deepEqual(
      { type: n.type, name: n.name, x: n.x, y: n.y, width: n.width, height: n.height, depth: n.depth, hidden: n.hidden },
      { type: 'instance', name: '.modalHeader', x: 0, y: 0, width: 780, height: 54, depth: 3, hidden: false })
  })
  test('이름의 XML 엔티티를 푼다 — 안 풀면 grep 이 원문과 안 맞는다', () => {
    assert.equal(byId('6853:56204').name, '     ↪︎ 디자인 모드 -> 커스텀 위젯')
  })
  test('hidden="true" 를 잡는다', () => {
    assert.equal(byId('0:2').hidden, true)
    assert.equal(byId('5202:50995').hidden, true)
  })
  test('조상 경로를 이름으로 쌓는다', () => {
    assert.deepEqual(byId('I7327:61763;5979:68627').path,
      ['Document', '     ↪︎ 디자인 모드 -> 커스텀 위젯', 'screen', '.modalHeader', 'Horizontal Tab'])
  })
  test('형제로 돌아오면 스택이 되감긴다 — 안 되감으면 경로가 오염된다', () => {
    assert.deepEqual(byId('5202:50995').path, ['Document', '     ↪︎ 디자인 모드 -> 커스텀 위젯', 'screen', 'leadingtButton'])
  })
})

describe('renderTree — 깊이로 자르고 숨김은 기본 제외', () => {
  test('depth 1 은 캔버스까지', () => {
    const lines = renderTree(nodes, { depth: 1 }).split('\n')
    assert.equal(lines.length, 3) // document + 보이는 canvas 2개
    assert.match(lines[1], /⚪️  진행중  \[canvas 7214:58559\]$/) // 0×0 은 찍지 않는다
  })
  test('--hidden 이면 숨김 캔버스도 나온다', () => {
    assert.equal(renderTree(nodes, { depth: 1, hidden: true }).split('\n').length, 4)
    assert.match(renderTree(nodes, { depth: 1, hidden: true }), /Internal Only Canvas.*\(숨김\)/)
  })
  test('크기가 있으면 크기와 좌표를 찍는다', () => {
    assert.match(renderTree(nodes, { depth: 3 }), /\.modalHeader {2}\[instance 7327:61763\] 780×54 @0,0/)
  })
})

describe('findNodes — 이름 정규식, 대소문자 무시', () => {
  test('부분 일치', () => {
    assert.deepEqual(findNodes(nodes, 'modalheader').map((n) => n.id), ['7327:61763'])
  })
  test('숨김은 기본 제외, --hidden 으로 포함', () => {
    assert.equal(findNodes(nodes, 'leadingt').length, 0)
    assert.equal(findNodes(nodes, 'leadingt', { hidden: true }).length, 1)
  })
})

describe('parseArgs', () => {
  test('옵션과 위치 인자를 가른다', () => {
    const { opts, positional } = parseArgs(['tree', '7327-61763', '-d', '3', '--json', '-o', 'a.txt'])
    assert.deepEqual(positional, ['tree', '7327-61763'])
    assert.equal(opts.depth, 3)
    assert.equal(opts.json, true)
    assert.equal(opts.out, 'a.txt')
  })
  test('모르는 옵션은 조용히 무시하지 않는다', () => {
    assert.throws(() => parseArgs(['tree', '--nope']), /모르는 옵션/)
  })
  test('--depth 에 숫자가 아닌 값', () => {
    assert.throws(() => parseArgs(['tree', '-d', 'x']), /숫자/)
  })
})
