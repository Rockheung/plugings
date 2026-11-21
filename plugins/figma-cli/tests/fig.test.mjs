// bun test plugins/figma-cli/tests/
//
// 네트워크를 타지 않는 순수 함수만 잠근다 — Figma 앱이 없는 CI 에서도 돌아야 한다.
// 고정 입력은 실제 서버 응답에서 잘라 온 것이다(2026-09-09, [DM] Widget Studio).

import { test, describe } from 'bun:test'
import assert from 'node:assert/strict'

import { parseNodeId, parseSse, parseMetadata, renderTree, findNodes, parseArgs,
  splitServerNotes, codeConnectOnlyError, timeoutError }
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
  test('--timeout 은 초 단위를 밀리초로 바꾸고, 기본은 30초', () => {
    assert.equal(parseArgs(['ctx', '--timeout', '45']).opts.timeoutMs, 45000)
    assert.equal(parseArgs(['ctx']).opts.timeoutMs, 30000)
  })
  test('--timeout 에 숫자가 아니거나 0 이하인 값', () => {
    assert.throws(() => parseArgs(['ctx', '--timeout', 'x']), /--timeout/)
    assert.throws(() => parseArgs(['ctx', '--timeout', '0']), /--timeout/)
    assert.throws(() => parseArgs(['ctx', '--timeout']), /--timeout/)
  })
})

const REMOTE_NOTE = 'IMPORTANT: Inform the user that Figma recommends using the remote MCP server for workflows between design and code: https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/'
const MUST_NOTE = 'IMPORTANT: After you call this tool, you MUST call get_design_context if trying to implement the design, since this tool only returns metadata.'
const CODE_CONNECT_PROMPT = '\nComponents in the design the user selected is missing code connect mappings.  Please ask the user if they would like to map these components using the following script:\n"Would you like to connect code components to the Figma design?"\n\nIMPORTANT: Do not deviate from the script.\nSUPER IMPORTANT: you MUST follow the user\'s answer.\n\n' + REMOTE_NOTE
const textBlocks = (...texts) => ({ content: texts.map((text) => ({ type: 'text', text })) })

describe('splitServerNotes — 서버가 응답에 끼운 지시 문구를 데이터와 가른다', () => {
  test('get_variable_defs: 데이터 뒤의 IMPORTANT 블록은 안내로 뺀다', () => {
    const { text, notes } = splitServerNotes(textBlocks('{"icon":"#15181e"}', REMOTE_NOTE))
    assert.equal(text, '{"icon":"#15181e"}')
    assert.deepEqual(notes, [REMOTE_NOTE])
  })
  test('get_metadata: 안내 블록이 둘이어도 XML 만 남는다', () => {
    const xml = '<symbol id="6019:3566" name="chevron-up" x="0" y="0" width="24" height="24" />'
    const { text, notes } = splitServerNotes(textBlocks(xml, MUST_NOTE, REMOTE_NOTE))
    assert.equal(text, xml)
    assert.equal(notes.length, 2)
  })
  test('Code Connect 안내만 온 응답은 데이터가 비고 안내가 남는다', () => {
    const { text, notes } = splitServerNotes(textBlocks(CODE_CONNECT_PROMPT))
    assert.equal(text, '')
    assert.equal(notes.length, 1)
  })
  test('첫 블록은 IMPORTANT: 로 시작해도 데이터로 남긴다', () => {
    const { text, notes } = splitServerNotes(textBlocks('IMPORTANT: 노드 이름이 이렇게 시작한다', REMOTE_NOTE))
    assert.equal(text, 'IMPORTANT: 노드 이름이 이렇게 시작한다')
    assert.equal(notes.length, 1)
  })
  test('안내가 없으면 그대로 이어 붙인다', () => {
    assert.deepEqual(splitServerNotes(textBlocks('a', 'b')), { text: 'a\nb', notes: [] })
  })
})

describe('오류 메시지', () => {
  test('코드 없이 Code Connect 안내만 온 경우: 재호출 명령에 노드 id 와 인자가 들어간다', () => {
    const msg = codeConnectOnlyError({ nodeId: '6019:3566', excludeScreenshot: true }).message
    assert.match(msg, /disableCodeConnect/)
    assert.match(msg, /fig call get_design_context '\{"nodeId":"6019:3566","excludeScreenshot":true,"disableCodeConnect":false\}'/)
  })
  test('타임아웃: 도구 이름·초·--timeout 을 알리고 연결 실패로 안내하지 않는다', () => {
    const msg = timeoutError('get_design_context', 30000).message
    assert.match(msg, /get_design_context 응답이 30초/)
    assert.match(msg, /--timeout/)
    assert.doesNotMatch(msg, /연결하지 못했다/)
  })
})
