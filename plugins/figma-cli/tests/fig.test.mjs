// bun test plugins/figma-cli/tests/
//
// 고정 입력은 실제 서버 응답에서 잘라 온 것이다(2026-09-09, [DM] Widget Studio).

import { test, describe, afterAll } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parseNodeId, parseSse, parseMetadata, renderTree, findNodes, parseArgs,
  splitServerNotes, codeConnectOnlyError, timeoutError, describeServerError,
  limitHits, parseSquare, agoText, sameNode, writeIndex, readIndex, isFreshIndex, INDEX_TRUST_MS,
  parseFileKey, readToken, fetchFileMeta, recordCall, readCalls, checkBudget, renderUsage, repeatLines, outputLines, responseKey, lookupResponse, storeResponse, sameResponseNote, MIN_SAME_RESPONSE_BYTES, MAX_STORED_RESPONSES, MCP_LIMIT_HOLD_MS }
  from '../skills/figma/scripts/fig.mjs'

process.env.XDG_STATE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-state-'))
afterAll(() => fs.rmSync(process.env.XDG_STATE_HOME, { recursive: true, force: true }))

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
  test('--timeout 은 초 단위를 밀리초로 바꾸고, 기본은 15초', () => {
    assert.equal(parseArgs(['ctx', '--timeout', '45']).opts.timeoutMs, 45000)
    assert.equal(parseArgs(['ctx']).opts.timeoutMs, 15000)
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
const SUPER_CRITICAL_NOTE = "SUPER CRITICAL: The generated React+Tailwind code MUST be converted to match the target project's technology stack and styling system.\n1. Analyze the target codebase to identify: technology stack, styling approach, component patterns, and design tokens\nDO NOT install any Tailwind as a dependency unless the user instructs you to do so.\n"
const NODE_IDS_NOTE = 'Node ids have been added to the code as data attributes, e.g. `data-node-id="1:2"`.'
const IMAGE_ASSETS_NOTE = 'Image assets are stored on a localhost server. Clients can use these images directly in code as a way to view the image assets the same way they would other remote servers.'
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
  test('get_design_context: 코드 뒤에 오는 블록은 접두어와 상관없이 모두 안내다', () => {
    const code = 'export default function ChevronUp() { return null }'
    const { text, notes } = splitServerNotes(textBlocks(code, SUPER_CRITICAL_NOTE, NODE_IDS_NOTE, IMAGE_ASSETS_NOTE, REMOTE_NOTE))
    assert.equal(text, code)
    assert.deepEqual(notes, [SUPER_CRITICAL_NOTE, NODE_IDS_NOTE, IMAGE_ASSETS_NOTE, REMOTE_NOTE])
  })
  test('블록이 하나뿐이면 그것이 데이터다', () => {
    assert.deepEqual(splitServerNotes(textBlocks('a')), { text: 'a', notes: [] })
  })
  test('텍스트 블록이 없으면 데이터도 안내도 비어 있다', () => {
    assert.deepEqual(splitServerNotes({ content: [{ type: 'image', data: 'AA==' }] }), { text: '', notes: [] })
  })
})

describe('오류 메시지', () => {
  test('코드 없이 Code Connect 안내만 온 경우: 재호출 명령에 노드 id 와 인자가 들어간다', () => {
    const msg = codeConnectOnlyError({ nodeId: '6019:3566', excludeScreenshot: true }).message
    assert.match(msg, /disableCodeConnect 는 서버 도구 스키마\(fig tools\)에 없는 인자/)
    assert.match(msg, /fig call get_design_context '\{"nodeId":"6019:3566","excludeScreenshot":true,"forceCode":true\}'/)
  })
  test('타임아웃: 도구 이름·초·--timeout 을 알리고 연결 실패로 안내하지 않는다', () => {
    const msg = timeoutError('get_design_context', 30000).message
    assert.match(msg, /get_design_context 응답이 30초/)
    assert.match(msg, /--timeout/)
    assert.doesNotMatch(msg, /연결하지 못했다/)
  })
  test('활성 탭이 파일이 아닌 서버 오류: 한국어 대처와 서버 원문을 함께 낸다', () => {
    const msg = describeServerError('The MCP server is only available if your active tab is a design or FigJam file.', -32603).message
    assert.match(msg, /활성 탭이 디자인·FigJam 파일이 아니다/)
    assert.match(msg, /only available if your active tab.*\(code -32603\)/)
  })
  test('그 밖의 서버 오류는 원문과 코드를 그대로 낸다', () => {
    assert.equal(describeServerError('Node with guid 1:2 is invalid', -32603).message, 'Node with guid 1:2 is invalid (code -32603)')
  })
  test('코드가 없는 오류는 원문만 낸다', () => {
    assert.equal(describeServerError('Node with guid 1:2 is invalid').message, 'Node with guid 1:2 is invalid')
  })
  test('호출 상한 오류: 막히는 명령과 공식 문서 주소를 알리고 서버 원문을 함께 낸다', () => {
    const msg = describeServerError('Rate limit exceeded, please try again tomorrow').message
    assert.match(msg, /읽기 호출 상한에 걸렸다/)
    assert.match(msg, /meta·ctx·vars·shot·find·tree/)
    assert.match(msg, /developers\.figma\.com\/docs\/figma-mcp-server\/rate-limits-access/)
    assert.match(msg, /\(서버 응답: Rate limit exceeded, please try again tomorrow\)/)
  })
})

describe('splitServerNotes — 이미지가 앞서는 응답', () => {
  test('get_screenshot 형태: 데이터 텍스트는 없고 텍스트 블록은 전부 안내다', () => {
    const result = { content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }, { type: 'text', text: REMOTE_NOTE }] }
    assert.deepEqual(splitServerNotes(result), { text: '', notes: [REMOTE_NOTE] })
  })
})

const FILTER_XML = `<document id="0:0" name="Document" x="0" y="0" width="0" height="0">
  <canvas id="6028:76561" name="Design" x="0" y="0" width="0" height="0">
    <symbol id="6019:3566" name="chevron-up" x="0" y="0" width="24" height="24">
      <vector id="6019:3567" name="Icon" x="6" y="9" width="12" height="6" />
    </symbol>
    <symbol id="6030:7232" name="chevron-down" x="0" y="0" width="24" height="24" />
    <instance id="6166:1" name="chevron-up" x="10" y="10" width="16" height="16" />
    <frame id="6040:423" name="Type=Address bar, Orientation=Portrait, Scrolled=No" x="0" y="0" width="390" height="844" />
    <frame id="6040:424" name="Type=Address bar, Orientation=Landscape, Scrolled=No" x="0" y="0" width="844" height="390" />
    <text id="6028:76635" name="주문 조회" x="0" y="0" width="60" height="20" />
    <frame id="6040:500" name="square-hidden" x="0" y="0" width="24" height="24" hidden="true" />
  </canvas>
</document>`
const filterNodes = parseMetadata(FILTER_XML)
const ids = (hits) => hits.map((n) => n.id)

describe('findNodes — 구조 필터', () => {
  test('--type: 그 타입만', () => {
    assert.deepEqual(ids(findNodes(filterNodes, '.', { type: 'symbol' })), ['6019:3566', '6030:7232'])
  })
  test('--square 범위: 너비=높이이고 범위 안인 것만, 크기 0 인 document·canvas 는 빠진다', () => {
    assert.deepEqual(ids(findNodes(filterNodes, '.', { square: [8, 48] })), ['6019:3566', '6030:7232', '6166:1'])
  })
  test('--square 한 값은 그 크기만', () => {
    assert.deepEqual(ids(findNodes(filterNodes, '.', { square: [24, 24] })), ['6019:3566', '6030:7232'])
  })
  test('--prop: 이름의 이름=값 조각이 정확히 일치해야 한다', () => {
    assert.deepEqual(ids(findNodes(filterNodes, '.', { prop: 'Orientation=Portrait' })), ['6040:423'])
    assert.deepEqual(ids(findNodes(filterNodes, '.', { prop: 'Orientation=Port' })), [])
  })
  test('필터는 이름 패턴과 겹쳐 쓴다', () => {
    assert.deepEqual(ids(findNodes(filterNodes, 'chevron', { type: 'instance', square: [8, 48] })), ['6166:1'])
  })
  test('숨김은 기본 제외, hidden 으로 포함', () => {
    assert.deepEqual(ids(findNodes(filterNodes, 'square-hidden', { square: [24, 24] })), [])
    assert.deepEqual(ids(findNodes(filterNodes, 'square-hidden', { square: [24, 24], hidden: true })), ['6040:500'])
  })
})

describe('limitHits — stdout 출력 상한', () => {
  const hits = [1, 2, 3, 4, 5]
  test('상한 안이면 그대로', () => {
    assert.deepEqual(limitHits(hits, 5), { shown: hits, more: 0 })
  })
  test('상한을 넘으면 앞쪽만 보이고 남은 건수를 센다', () => {
    assert.deepEqual(limitHits(hits, 2), { shown: [1, 2], more: 3 })
  })
  test('0 은 제한 없음', () => {
    assert.deepEqual(limitHits(hits, 0), { shown: hits, more: 0 })
  })
})

describe('parseSquare', () => {
  test('한 값과 범위', () => {
    assert.deepEqual(parseSquare('24'), [24, 24])
    assert.deepEqual(parseSquare('8-48'), [8, 48])
  })
  test('읽을 수 없거나 거꾸로 된 범위', () => {
    assert.throws(() => parseSquare('x'), /--square/)
    assert.throws(() => parseSquare(undefined), /--square/)
    assert.throws(() => parseSquare('48-8'), /작은 값-큰 값/)
  })
})

describe('parseArgs — 찾기 옵션', () => {
  test('기본값: 상한 50, 필터 없음, 색인 안 씀', () => {
    const { opts } = parseArgs(['find', 'x'])
    assert.deepEqual([opts.limit, opts.type, opts.prop, opts.square, opts.index], [50, null, null, null, false])
  })
  test('옵션을 읽는다', () => {
    const { opts } = parseArgs(['find', 'x', '--limit', '0', '--type', 'frame', '--prop', 'A=b', '--square', '8-48', '--index'])
    assert.deepEqual([opts.limit, opts.type, opts.prop, opts.square, opts.index], [0, 'frame', 'A=b', [8, 48], true])
  })
  test('잘못된 값은 조용히 넘기지 않는다', () => {
    assert.throws(() => parseArgs(['find', 'x', '--limit', '-1']), /--limit/)
    assert.throws(() => parseArgs(['find', 'x', '--limit', '1.5']), /--limit/)
    assert.throws(() => parseArgs(['find', 'x', '--limit']), /--limit/)
    assert.throws(() => parseArgs(['find', 'x', '--type']), /--type/)
    assert.throws(() => parseArgs(['find', 'x', '--prop', 'abc']), /--prop/)
    assert.throws(() => parseArgs(['find', 'x', '--prop']), /--prop/)
  })
})

describe('agoText · sameNode', () => {
  test('경과 시간을 한국어로', () => {
    assert.equal(agoText(30000), '방금')
    assert.equal(agoText(5 * 60000), '5분 전')
    assert.equal(agoText(3 * 3600000), '3시간 전')
    assert.equal(agoText(49 * 3600000), '2일 전')
  })
  test('노드 비교는 id·타입·이름·좌표·크기·숨김만 본다', () => {
    const a = filterNodes[2]
    assert.equal(sameNode(a, { ...a, depth: 9, path: ['x'] }), true)
    assert.equal(sameNode(a, { ...a, width: a.width + 1 }), false)
    assert.equal(sameNode(a, { ...a, name: `${a.name}!` }), false)
  })
})

describe('색인 — 저장하고 읽어도 라이브와 같은 노드다', () => {
  const withDir = (fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-test-'))
    try { return fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
  test('저장한 XML 을 읽으면 파싱 결과가 그대로다', () => withDir((dir) => {
    writeIndex(FILTER_XML, filterNodes, dir, 1000)
    assert.deepEqual(readIndex(dir).nodes, filterNodes)
  }))
  test('메타: 개수·캔버스 이름·만든 시각·마지막 노드(확인용)', () => withDir((dir) => {
    const meta = writeIndex(FILTER_XML, filterNodes, dir, 1000)
    assert.equal(meta.count, 10)
    assert.deepEqual(meta.canvases, ['Design'])
    assert.equal(meta.builtAt, 1000)
    assert.equal(meta.probe.id, '6040:500')
    assert.deepEqual(readIndex(dir).meta, meta)
  }))
  test('색인에서 찾은 결과가 라이브와 같다 (메타문자·대소문자 포함)', () => withDir((dir) => {
    writeIndex(FILTER_XML, filterNodes, dir)
    const stored = readIndex(dir).nodes
    for (const pattern of ['chevron', '^chev', 'CHEVRON', '주문', '\\(', '.']) {
      assert.deepEqual(ids(findNodes(stored, pattern, { square: null })), ids(findNodes(filterNodes, pattern)))
    }
  }))
  test('색인이 없으면 만드는 방법을 알린다', () => withDir((dir) => {
    assert.throws(() => readIndex(dir), /fig index/)
  }))
  test('노드가 없는 문서는 색인으로 만들지 않는다', () => withDir((dir) => {
    assert.throws(() => writeIndex('', [], dir), /노드가 없어/)
  }))
})

describe('CLI 프로세스 — 로컬 가짜 서버로 실제 실행', () => {
  const FIG = path.join(import.meta.dir, '../skills/figma/scripts/fig.mjs')
  const sse = (obj, sid) => new Response(`event: message\ndata: ${JSON.stringify(obj)}\n\n`,
    { headers: { 'content-type': 'text/event-stream', ...(sid ? { 'mcp-session-id': sid } : {}) } })

  const run = async (toolResult, args, { viaShellPipe = false, prepare = null, env = {}, rest = null, cacheDir = null } = {}) => {
    let calls = 0
    let restCalls = 0
    let restToken = null
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json()
        if (body.method === 'initialize') return sse({ jsonrpc: '2.0', id: body.id, result: {} }, 'S')
        if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
        if (req.headers.get('mcp-session-id') === 'STALE') return new Response('{"error":{"code":-32002,"message":"No session found"}}', { status: 404 })
        calls += 1
        return sse({ jsonrpc: '2.0', id: body.id, result: toolResult })
      },
    })
    const restServer = rest && Bun.serve({
      port: 0,
      fetch(req) {
        restCalls += 1
        restToken = req.headers.get('x-figma-token')
        return rest(req)
      },
    })
    const cache = cacheDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fig-test-'))
    try {
      prepare?.(path.join(cache, 'fig'))
      const command = viaShellPipe
        ? ['sh', '-c', '"$0" "$@" | cat', process.execPath, FIG, ...args]
        : [process.execPath, FIG, ...args]
      const proc = Bun.spawn(command, {
        env: {
          ...process.env,
          FIG_MCP_URL: `http://127.0.0.1:${server.port}/mcp`,
          XDG_CACHE_HOME: cache,
          XDG_CONFIG_HOME: cache,
          XDG_STATE_HOME: cache,
          FIGMA_TOKEN: '',
          ...(restServer ? { FIG_REST_URL: `http://127.0.0.1:${restServer.port}` } : {}),
          ...env,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [out, err, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited])
      const metaPath = path.join(cache, 'fig', 'index.json')
      const indexMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null
      const ledger = readCalls(Date.now() - 48 * 3600000, path.join(cache, 'fig'), Date.now() + 1000)
      return { bytes: out.byteLength, out: Buffer.from(out).toString('utf8'), err, code, calls, restCalls, restToken, indexMeta, ledger }
    } finally {
      server.stop(true)
      restServer?.stop(true)
      if (!cacheDir) fs.rmSync(cache, { recursive: true, force: true })
    }
  }

  test('128KB 를 넘는 출력도 셸 파이프로 끝까지 나온다', async () => {
    const text = '가나다 abc 0123456789\n'.repeat(20000)
    const { bytes } = await run({ content: [{ type: 'text', text }] }, ['call', 'get_x', '{}'], { viaShellPipe: true })
    assert.equal(bytes, Buffer.byteLength(text))
  })
  test('큰 출력도 종료 코드는 0 이다', async () => {
    const text = '가나다 abc 0123456789\n'.repeat(20000)
    const { code } = await run({ content: [{ type: 'text', text }] }, ['call', 'get_x', '{}'])
    assert.equal(code, 0)
  })
  test('호출 상한 오류는 종료 코드 1 과 한국어 안내를 stderr 로 낸다', async () => {
    const { err, code } = await run({ isError: true, content: [{ type: 'text', text: 'Rate limit exceeded, please try again tomorrow' }] }, ['vars', '1:2'])
    assert.equal(code, 1)
    assert.match(err, /읽기 호출 상한에 걸렸다/)
  })

  const probeNode = (name) => ({ content: [{ type: 'text', text: `<frame id="6040:500" name="${name}" x="0" y="0" width="24" height="24" hidden="true" />` }] })
  const indexBuiltAt = (builtAt, file = null) => (dir) => writeIndex(FILTER_XML, filterNodes, dir, builtAt, file)

  test('5분 이내 색인은 서버를 부르지 않고 답한다', async () => {
    const { out, err, code, calls } = await run(probeNode('square-hidden'), ['find', 'chevron', '--index', '--limit', '0'], { prepare: indexBuiltAt(Date.now() - 60000) })
    assert.equal(code, 0)
    assert.equal(calls, 0)
    assert.match(out, /chevron-up/)
    assert.match(err, /서버 확인 생략/)
  })
  test('5분이 지난 색인은 마지막 노드를 서버에 한 번 확인하고 같으면 답한다', async () => {
    const { out, err, code, calls } = await run(probeNode('square-hidden'), ['find', 'chevron', '--index', '--limit', '0'], { prepare: indexBuiltAt(Date.now() - INDEX_TRUST_MS - 60000) })
    assert.equal(code, 0)
    assert.equal(calls, 1)
    assert.match(out, /chevron-up/)
    assert.doesNotMatch(err, /서버 확인 생략/)
  })
  test('5분이 지난 색인이 다른 파일의 것이면 답하지 않는다', async () => {
    const { out, err, code, calls } = await run(probeNode('다른 파일의 노드'), ['find', 'chevron', '--index', '--limit', '0'], { prepare: indexBuiltAt(Date.now() - INDEX_TRUST_MS - 60000) })
    assert.equal(code, 1)
    assert.equal(calls, 1)
    assert.equal(out, '')
    assert.match(err, /색인과 다르거나/)
  })

  const TOKEN = 'figd_TEST_TOKEN_VALUE_0123456789abcdef'
  const FILE_KEY = 'ABCDEFGHIJK1234'
  const FILE_URL = `https://www.figma.com/design/${FILE_KEY}/Name?node-id=1-2`
  const restMeta = (touched) => () => Response.json({ file: { name: 'N', last_touched_at: touched } })
  const restStatus = (status) => () => new Response('{}', { status })
  const stamp = (touched) => ({ key: FILE_KEY, lastTouchedAt: touched })
  const stale = () => Date.now() - 60 * 60000
  const findArgs = ['find', 'chevron', '--index', '--limit', '0']
  const metadataResult = { content: [{ type: 'text', text: FILTER_XML }] }

  test('fig index <URL>: 만들 때 파일의 마지막 편집 기록을 REST meta 로 받아 색인에 저장한다', async () => {
    const r = await run(metadataResult, ['index', FILE_URL], { env: { FIGMA_TOKEN: TOKEN }, rest: restMeta('T1') })
    assert.equal(r.code, 0)
    assert.deepEqual(r.indexMeta.file, stamp('T1'))
    assert.equal(r.restToken, TOKEN)
    assert.equal(r.calls, 1)
    assert.equal(r.out.includes(TOKEN) || r.err.includes(TOKEN), false)
  })
  test('fig index <URL> 인데 토큰이 없으면 MCP 를 부르기 전에 안내하고 끝난다', async () => {
    const r = await run(metadataResult, ['index', FILE_URL], { rest: restMeta('T1') })
    assert.equal(r.code, 1)
    assert.equal(r.calls, 0)
    assert.match(r.err, /토큰이 없다/)
  })
  test('fig index 에 URL 이 없으면 REST 를 부르지 않는다', async () => {
    const r = await run(metadataResult, ['index'], { env: { FIGMA_TOKEN: TOKEN }, rest: restMeta('T1') })
    assert.equal(r.code, 0)
    assert.equal(r.restCalls, 0)
    assert.equal(r.indexMeta.file, undefined)
  })
  test('파일 기록이 같으면 MCP 를 부르지 않고 답한다 (5분이 지난 색인도)', async () => {
    const r = await run(probeNode('square-hidden'), findArgs, { env: { FIGMA_TOKEN: TOKEN }, rest: restMeta('T1'), prepare: indexBuiltAt(stale(), stamp('T1')) })
    assert.equal(r.code, 0)
    assert.equal(r.calls, 0)
    assert.equal(r.restCalls, 1)
    assert.match(r.out, /chevron-up/)
    assert.match(r.err, /파일 변경 없음 확인/)
    assert.equal(r.out.includes(TOKEN) || r.err.includes(TOKEN), false)
  })
  test('파일 기록이 다르면 방금 만든 색인이라도 답하지 않고 다시 만들라고 한다', async () => {
    const r = await run(probeNode('square-hidden'), findArgs, { env: { FIGMA_TOKEN: TOKEN }, rest: restMeta('T2'), prepare: indexBuiltAt(Date.now() - 60000, stamp('T1')) })
    assert.equal(r.code, 1)
    assert.equal(r.calls, 0)
    assert.equal(r.out, '')
    assert.match(r.err, /바뀌었다/)
  })
  test('REST 가 실패하면 알리고 5분 규칙으로 돌아간다: 오래된 색인은 MCP 로 확인한다', async () => {
    const r = await run(probeNode('square-hidden'), findArgs, { env: { FIGMA_TOKEN: TOKEN }, rest: restStatus(401), prepare: indexBuiltAt(stale(), stamp('T1')) })
    assert.equal(r.code, 0)
    assert.equal(r.calls, 1)
    assert.match(r.err, /파일 변경 확인에 실패해 5분 규칙으로 답한다 — 토큰이 무효/)
    assert.equal(r.out.includes(TOKEN) || r.err.includes(TOKEN), false)
  })
  test('REST 가 실패해도 5분 미만 색인은 MCP 를 부르지 않는다', async () => {
    const r = await run(probeNode('square-hidden'), findArgs, { env: { FIGMA_TOKEN: TOKEN }, rest: restStatus(429), prepare: indexBuiltAt(Date.now() - 60000, stamp('T1')) })
    assert.equal(r.code, 0)
    assert.equal(r.calls, 0)
    assert.match(r.err, /호출 한도에 걸렸다/)
  })
  test('색인에 파일 기록이 있는데 토큰이 없으면 알리고 5분 규칙으로 답한다', async () => {
    const r = await run(probeNode('square-hidden'), findArgs, { rest: restMeta('T1'), prepare: indexBuiltAt(Date.now() - 60000, stamp('T1')) })
    assert.equal(r.code, 0)
    assert.equal(r.restCalls, 0)
    assert.equal(r.calls, 0)
    assert.match(r.err, /토큰이 없어 파일 변경 확인을 건너뛴다/)
  })
  test('파일 기록이 없는 색인은 REST 를 부르지 않는다', async () => {
    const r = await run(probeNode('square-hidden'), findArgs, { env: { FIGMA_TOKEN: TOKEN }, rest: restMeta('T1'), prepare: indexBuiltAt(Date.now() - 60000) })
    assert.equal(r.code, 0)
    assert.equal(r.restCalls, 0)
  })

  const MIN = 60000
  const HOUR = 60 * MIN
  const past = (...items) => (dir) => items.forEach(([entry, ago]) => recordCall(entry, dir, Date.now() - ago))
  const mcpCall = { backend: 'mcp', kind: 'tools/call', name: 'get_metadata', http: 200 }
  const mcpLimit = { event: 'limit', backend: 'mcp', name: 'get_metadata' }
  const restLimit = (retryAfterSec) => ({ event: 'limit', backend: 'rest', name: 'files/meta', retryAfterSec })

  test('MCP 요청은 전부 원장에 남는다: 초기화와 도구 호출, 명령 이름, 상태와 크기', async () => {
    const r = await run(metadataResult, ['find', 'chevron', '--limit', '0'])
    assert.equal(r.code, 0)
    const kinds = r.ledger.filter((c) => !c.event).map((c) => c.kind)
    assert.deepEqual(kinds, ['initialize', 'notifications/initialized', 'tools/call'])
    const call = r.ledger.filter((c) => !c.event).at(-1)
    assert.equal(call.name, 'get_metadata')
    assert.equal(call.cmd, 'find')
    assert.equal(call.http, 200)
    assert.ok(call.bytes > 0 && call.ms >= 0)
    assert.equal(r.ledger.filter((c) => !c.event).length, 1 + r.calls + 1)
  })
  test('서버가 상한을 알리면 원장에 상한 기록이 남는다', async () => {
    const r = await run({ isError: true, content: [{ type: 'text', text: 'Rate limit exceeded, please try again tomorrow' }] }, ['vars', '1:2'])
    assert.equal(r.code, 1)
    assert.deepEqual(r.ledger.filter((c) => c.event).map(({ event, backend, name }) => ({ event, backend, name })), [{ event: 'limit', backend: 'mcp', name: 'get_variable_defs' }])
  })
  test('설정한 예산에 닿으면 서버에 보내지 않고 --force 를 안내한다', async () => {
    const r = await run(metadataResult, ['find', 'chevron'], { env: { FIG_BUDGET_MCP_DAY: '3' }, prepare: past([mcpCall, MIN], [mcpCall, MIN], [mcpCall, MIN]) })
    assert.equal(r.code, 1)
    assert.equal(r.calls, 0)
    assert.equal(r.out, '')
    assert.match(r.err, /호출 예산 때문에 MCP 호출을 보내지 않았다/)
    assert.match(r.err, /3회를 이 CLI 가 보냈고 설정한 예산 3회에 도달/)
    assert.match(r.err, /--force/)
  })
  test('--force 를 주면 같은 상황에서 경고하고 보낸다', async () => {
    const r = await run(metadataResult, ['find', 'chevron', '--force', '--limit', '0'], { env: { FIG_BUDGET_MCP_DAY: '3' }, prepare: past([mcpCall, MIN], [mcpCall, MIN], [mcpCall, MIN]) })
    assert.equal(r.code, 0)
    assert.equal(r.calls, 1)
    assert.match(r.err, /--force 라서 보낸다/)
  })
  test('예산 미만이면 막지 않는다', async () => {
    const r = await run(metadataResult, ['find', 'chevron', '--limit', '0'], { env: { FIG_BUDGET_MCP_DAY: '4' }, prepare: past([mcpCall, MIN], [mcpCall, MIN], [mcpCall, MIN]) })
    assert.equal(r.code, 0)
    assert.equal(r.calls, 1)
  })
  test('서버가 상한을 알린 직후에는 같은 호출을 서버에 보내지 않는다', async () => {
    const r = await run(metadataResult, ['find', 'chevron'], { prepare: past([mcpLimit, 10 * MIN]) })
    assert.equal(r.code, 1)
    assert.equal(r.calls, 0)
    assert.match(r.err, /서버가 MCP 호출 상한을 알렸다/)
  })
  test('보류 시간이 지나면 다시 보낸다', async () => {
    const r = await run(metadataResult, ['find', 'chevron', '--limit', '0'], { prepare: past([mcpLimit, MCP_LIMIT_HOLD_MS + MIN]) })
    assert.equal(r.code, 0)
    assert.equal(r.calls, 1)
  })
  test('fig tools 는 예산 검사 대상이 아니다', async () => {
    const r = await run({ tools: [] }, ['tools'], { env: { FIG_BUDGET_MCP_DAY: '1' }, prepare: past([mcpCall, MIN]) })
    assert.equal(r.code, 0)
    assert.equal(r.calls, 1)
  })
  test('REST 429 는 Retry-After 와 함께 원장에 남고, 그 시간 안에는 REST 를 보내지 않는다', async () => {
    const first = await run(metadataResult, ['index', FILE_URL], { env: { FIGMA_TOKEN: TOKEN }, rest: () => new Response('{}', { status: 429, headers: { 'retry-after': '30' } }) })
    assert.equal(first.code, 1)
    assert.equal(first.calls, 0)
    assert.deepEqual(first.ledger.filter((c) => c.event).map((c) => [c.backend, c.retryAfterSec]), [['rest', 30]])
    const blocked = await run(metadataResult, ['index', FILE_URL], { env: { FIGMA_TOKEN: TOKEN }, rest: restMeta('T1'), prepare: past([restLimit(30), 5000]) })
    assert.equal(blocked.code, 1)
    assert.equal(blocked.restCalls, 0)
    assert.equal(blocked.calls, 0)
    assert.match(blocked.err, /호출 예산 때문에 REST 호출을 보내지 않았다/)
  })
  test('REST 가 막혀 있어도 --index 조회는 5분 규칙으로 답한다', async () => {
    const r = await run(probeNode('square-hidden'), findArgs, { env: { FIGMA_TOKEN: TOKEN }, rest: restMeta('T1'), prepare: (dir) => { indexBuiltAt(Date.now() - 60000, stamp('T1'))(dir); past([restLimit(60), 5000])(dir) } })
    assert.equal(r.code, 0)
    assert.equal(r.restCalls, 0)
    assert.equal(r.calls, 0)
    assert.match(r.err, /파일 변경 확인에 실패해 5분 규칙으로 답한다 — 호출 예산 때문에 REST/)
  })
  test('REST 요청도 원장에 남는다(티어·상태·명령)', async () => {
    const r = await run(probeNode('square-hidden'), findArgs, { env: { FIGMA_TOKEN: TOKEN }, rest: restMeta('T1'), prepare: indexBuiltAt(stale(), stamp('T1')) })
    const rest = r.ledger.filter((c) => c.backend === 'rest')
    assert.equal(rest.length, 1)
    assert.deepEqual([rest[0].kind, rest[0].name, rest[0].tier, rest[0].http, rest[0].cmd], ['GET', 'files/meta', 3, 200, 'find'])
  })
  test('fig usage 는 서버를 부르지 않고 집계를 보여 준다', async () => {
    const r = await run(metadataResult, ['usage'], { prepare: past([mcpCall, 30000], [mcpCall, 10 * MIN], [mcpCall, 3 * HOUR], [mcpLimit, 2 * HOUR]) })
    assert.equal(r.code, 0)
    assert.equal(r.calls, 0)
    assert.match(r.out, /mcp get_metadata\s+1\s+2\s+3\n/)
    assert.match(r.out, /mcp: 2시간 전 서버가 상한을 알렸다/)
    assert.match(r.out, /이 CLI 가 보낸 요청만 센다/)
  })
  const bigText = (tag) => `${tag}\n${'가나다 abc 0123456789\n'.repeat(120).trimEnd()}`
  const textResult = (text) => ({ content: [{ type: 'text', text }] })
  const withCache = async (fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-same-'))
    try { return await fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
  test('같은 호출의 응답이 이전 출력과 같으면 본문 대신 한 줄과 저장본 경로를 낸다', () => withCache(async (dir) => {
    const first = await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    assert.equal(first.out, `${bigText('A')}\n`)
    const second = await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    assert.equal(second.code, 0)
    assert.equal(second.calls, 1)
    assert.match(second.out, /^\(같은 응답 — 본문 생략\) .* 출력한 것과 내용이 같다 \(sha256 [0-9a-f]{12}, \d+B\)\. 저장본: \S+\.txt — 읽거나 --full 로 본문을 다시 낸다\.\n$/)
    assert.ok(second.bytes < first.bytes / 10)
    const saved = second.out.match(/저장본: (\S+\.txt)/)[1]
    assert.equal(fs.readFileSync(saved, 'utf8'), bigText('A'))
  }))
  test('응답이 바뀌면 본문을 다시 내고, 그 뒤 같은 응답은 다시 생략한다', () => withCache(async (dir) => {
    await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    const changed = await run(textResult(bigText('B')), ['meta', '1:2'], { cacheDir: dir })
    assert.equal(changed.out, `${bigText('B')}\n`)
    const again = await run(textResult(bigText('B')), ['meta', '1:2'], { cacheDir: dir })
    assert.match(again.out, /^\(같은 응답/)
  }))
  test('--full 은 같은 응답이어도 본문을 내고, -o 는 파일에 전부 쓴다', () => withCache(async (dir) => {
    await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    const full = await run(textResult(bigText('A')), ['meta', '1:2', '--full'], { cacheDir: dir })
    assert.equal(full.out, `${bigText('A')}\n`)
    const file = path.join(dir, 'out.txt')
    const toFile = await run(textResult(bigText('A')), ['meta', '1:2', '-o', file], { cacheDir: dir })
    assert.equal(toFile.out, '')
    assert.equal(fs.readFileSync(file, 'utf8'), `${bigText('A')}\n`)
  }))
  test('1KB 미만 응답은 같아도 본문을 낸다', () => withCache(async (dir) => {
    const small = textResult('x'.repeat(MIN_SAME_RESPONSE_BYTES - 1))
    await run(small, ['meta', '1:2'], { cacheDir: dir })
    const again = await run(small, ['meta', '1:2'], { cacheDir: dir })
    assert.equal(again.out, `${'x'.repeat(MIN_SAME_RESPONSE_BYTES - 1)}\n`)
  }))
  test('대상·출력 형식·도구가 다르면 서로 다른 응답으로 센다', () => withCache(async (dir) => {
    await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    const otherNode = await run(textResult(bigText('A')), ['meta', '3:4'], { cacheDir: dir })
    assert.doesNotMatch(otherNode.out, /^\(같은 응답/)
    const raw = await run(textResult(bigText('A')), ['meta', '1:2', '--raw'], { cacheDir: dir })
    assert.doesNotMatch(raw.out, /^\(같은 응답/)
    const otherTool = await run(textResult(bigText('A')), ['vars', '1:2'], { cacheDir: dir })
    assert.doesNotMatch(otherTool.out, /^\(같은 응답/)
    const textAgain = await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    assert.match(textAgain.out, /^\(같은 응답/)
  }))
  test('저장본이 지워졌으면 본문을 다시 낸다', () => withCache(async (dir) => {
    await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    for (const f of fs.readdirSync(path.join(dir, 'fig', 'responses'))) if (f.endsWith('.txt')) fs.rmSync(path.join(dir, 'fig', 'responses', f))
    const again = await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    assert.equal(again.out, `${bigText('A')}\n`)
  }))
  test('ctx 와 call 도 같은 응답을 생략하고, find·tree 는 대상이 아니다', () => withCache(async (dir) => {
    await run(textResult(bigText('A')), ['ctx', '1:2'], { cacheDir: dir })
    assert.match((await run(textResult(bigText('A')), ['ctx', '1:2'], { cacheDir: dir })).out, /^\(같은 응답/)
    await run(textResult(bigText('A')), ['call', 'get_x', '{"nodeId":"1:2"}'], { cacheDir: dir })
    assert.match((await run(textResult(bigText('A')), ['call', 'get_x', '{"nodeId":"1:2"}'], { cacheDir: dir })).out, /^\(같은 응답/)
    await run(metadataResult, ['find', 'chevron', '--limit', '0'], { cacheDir: dir })
    const again = await run(metadataResult, ['find', 'chevron', '--limit', '0'], { cacheDir: dir })
    assert.doesNotMatch(again.out, /^\(같은 응답/)
  }))
  test('생략한 본문 크기가 원장에 남고 fig usage 가 합계를 보여 준다', () => withCache(async (dir) => {
    await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    const second = await run(textResult(bigText('A')), ['meta', '1:2'], { cacheDir: dir })
    const omitted = second.ledger.filter((c) => c.event === 'output' && c.omitted)
    assert.deepEqual(omitted.map((c) => c.omitted), [Buffer.byteLength(bigText('A'))])
    const usage = await run(textResult(bigText('A')), ['usage'], { cacheDir: dir })
    assert.match(usage.out, new RegExp(`같은 응답이라 본문을 생략한 출력 1회, 생략한 본문 합계 ${Buffer.byteLength(bigText('A'))}B`))
  }))
  test('--help 는 호출 기록 명령·--force·예산 환경변수를 안내하고 종료 코드 0 이다', async () => {
    const r = await run(metadataResult, ['--help'])
    assert.equal(r.code, 0)
    assert.equal(r.calls, 0)
    for (const word of ['usage', '--force', 'FIG_BUDGET_MCP_DAY', 'FIG_BUDGET_REST_MIN', 'calls-<날짜>.jsonl']) assert.ok(r.out.includes(word), word)
  })
  const bigXml = `<document id="0:0" name="Document" x="0" y="0" width="0" height="0">\n  <canvas id="1:1" name="C" x="0" y="0" width="0" height="0">\n${Array.from({ length: 300 }, (_, i) => `    <frame id="2:${i}" name="f${i}" x="0" y="0" width="1" height="1" />`).join('\n')}\n  </canvas>\n</document>`
  const bigResult = { content: [{ type: 'text', text: bigXml }] }
  test('find 의 기본 건수 상한 50 은 그대로다', async () => {
    const r = await run(bigResult, ['find', 'f'])
    assert.equal(r.out.trimEnd().split('\n').length, 50)
    assert.match(r.err, /250건 더 있다/)
  })
  test('stdout 으로 나간 출력은 명령·바이트·줄 수와 함께 원장에 남고, 파일 출력은 구분되며, usage 는 기록하지 않는다', async () => {
    const r = await run(bigResult, ['tree'])
    const out = r.ledger.filter((c) => c.event === 'output')
    assert.deepEqual(out.map((c) => [c.cmd, c.to, c.bytes, c.lines]), [['tree', 'stdout', r.bytes, 302]])
    const file = path.join(os.tmpdir(), `fig-tree-${process.pid}-b.txt`)
    try {
      const f = await run(bigResult, ['tree', '-o', file])
      assert.deepEqual(f.ledger.filter((c) => c.event === 'output').map((c) => c.to), ['file'])
    } finally { fs.rmSync(file, { force: true }) }
    const u = await run(bigResult, ['usage'])
    assert.equal(u.ledger.filter((c) => c.event === 'output').length, 0)
  })
  test('fig usage 는 명령별 stdout 합계를 큰 순서로 보여 주고 파일 출력과 24시간 밖은 뺀다', async () => {
    const out = (cmd, bytes, to = 'stdout') => ({ event: 'output', to, cmd, bytes, lines: 1 })
    const r = await run(metadataResult, ['usage'], { prepare: past([out('find', 1000), MIN], [out('find', 3000), 2 * MIN], [out('tree', 5000), MIN], [out('tree', 99999, 'file'), MIN], [out('meta', 7777), 30 * HOUR]) })
    assert.match(r.out, /tree\s+1회\s+합계 5000B\s+최대 5000B\n\s+find\s+2회\s+합계 4000B\s+최대 3000B/)
    assert.doesNotMatch(r.out, /meta\s+\d+회|99999/)
    assert.match(r.out, /바이트 수이며 토큰 수가 아니다/)
  })
  test('만료된 세션의 404 재시도는 원장에 남지만 호출 수와 반복 집계에는 세지 않는다', async () => {
    const stale = (dir) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'session'), 'STALE\n') }
    const r = await run(metadataResult, ['find', 'chevron', '--limit', '0'], { prepare: stale })
    assert.equal(r.code, 0)
    assert.deepEqual(r.ledger.filter((c) => c.kind === 'tools/call').map((c) => c.http), [404, 200])
    assert.match(repeatLines(r.ledger).join('\n'), /tools\/call 1회 중 대상 노드가 있는 1회에서 같은 도구·노드를 다시 부른 것 0회/)
    assert.deepEqual(checkBudget('mcp', r.ledger, { FIG_BUDGET_MCP_DAY: '2' }), [])
    assert.equal(checkBudget('mcp', r.ledger, { FIG_BUDGET_MCP_DAY: '1' }).length, 1)
  })
  test('도구 호출은 대상 노드 id 와 함께 원장에 남고, 대상이 없으면 null 이다', async () => {
    const withTarget = await run(metadataResult, ['meta', '7327-61763'])
    assert.equal(withTarget.ledger.find((c) => c.kind === 'tools/call').node, '7327:61763')
    const selection = await run(metadataResult, ['meta'])
    assert.equal(selection.ledger.find((c) => c.kind === 'tools/call').node, null)
    const whole = await run(metadataResult, ['find', 'chevron'])
    assert.equal(whole.ledger.find((c) => c.kind === 'tools/call').node, '0:0')
    assert.equal(whole.ledger.find((c) => c.kind === 'initialize').node, undefined)
  })
  test('fig usage 는 같은 도구·노드의 반복 호출을 센다', async () => {
    const hit = (name, node) => ({ backend: 'mcp', kind: 'tools/call', name, node, http: 200 })
    const r = await run(metadataResult, ['usage'], { prepare: past([hit('get_design_context', '1:2'), 5 * MIN], [hit('get_design_context', '1:2'), 4 * MIN], [hit('get_design_context', '1:2'), 3 * MIN], [hit('get_design_context', '3:4'), 2 * MIN], [hit('get_metadata', null), MIN]) })
    assert.equal(r.code, 0)
    assert.match(r.out, /tools\/call 5회 중 대상 노드가 있는 4회에서 같은 도구·노드를 다시 부른 것 2회, 대상이 없는\(선택 노드\) 1회는 판정 제외/)
    assert.match(r.out, /get_design_context 1:2  ×3/)
    assert.doesNotMatch(r.out, /get_design_context 3:4  ×/)
  })
  test('원장에 쓸 수 없어도 명령은 진행하고 사유를 알린다', async () => {
    const r = await run(metadataResult, ['find', 'chevron', '--limit', '0'], { env: { XDG_STATE_HOME: '/dev/null' } })
    assert.equal(r.code, 0)
    assert.match(r.err, /호출 원장에 기록하지 못했다/)
  })
})

describe('호출 원장 — 읽기·예산 판정·집계', () => {
  const withDir = (fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-ledger-'))
    try { return fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
  const now = Date.UTC(2026, 10, 22, 12, 0, 0)
  const HOUR = 3600000
  const call = (over = {}) => ({ backend: 'mcp', kind: 'tools/call', name: 'get_metadata', ...over })

  test('날짜 파일을 넘나들어 읽고, 윈도 밖과 깨진 줄은 거른다', () => withDir((dir) => {
    recordCall(call({ n: 1 }), dir, now - 30 * HOUR)
    recordCall(call({ n: 2 }), dir, now - 13 * HOUR)
    recordCall(call({ n: 3 }), dir, now - 1000)
    fs.appendFileSync(path.join(dir, fs.readdirSync(dir).sort().at(-1)), 'not json\n\n')
    assert.deepEqual(readCalls(now - 24 * HOUR, dir, now).map((c) => c.n), [2, 3])
    assert.deepEqual(readCalls(now - 48 * HOUR, dir, now).map((c) => c.n), [1, 2, 3])
    assert.equal(fs.readdirSync(dir).length, 2)
  }))
  test('원장 파일 이름은 시간대와 무관하게 UTC 날짜다', () => withDir((dir) => {
    const before = process.env.TZ
    try {
      for (const [i, tz] of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC'].entries()) {
        process.env.TZ = tz
        const at = Date.UTC(2026, 10, 22, 12, i, 0)
        recordCall(call({ tz }), dir, at)
        assert.deepEqual(readCalls(at - 1000, dir, at + 1000).map((c) => c.tz), [tz])
      }
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
    assert.deepEqual(fs.readdirSync(dir), ['calls-2026-11-22.jsonl'])
  }))
  test('날짜 파일이 없으면 빈 배열이다', () => withDir((dir) => {
    assert.deepEqual(readCalls(now - 24 * HOUR, dir, now), [])
  }))

  test('예산: 설정이 없으면 막지 않는다', () => {
    assert.deepEqual(checkBudget('mcp', Array.from({ length: 500 }, () => ({ ...call(), t: now - 1000 })), {}, now), [])
  })
  test('예산: tools/call 만 센다(initialize·tools/list·상한 기록은 세지 않는다)', () => {
    const calls = [call({ t: now - 1000 }), call({ kind: 'initialize', name: null, t: now - 1000 }), call({ kind: 'tools/list', name: null, t: now - 1000 }), { event: 'limit', backend: 'rest', t: now - 1000 }]
    assert.deepEqual(checkBudget('mcp', calls, { FIG_BUDGET_MCP_DAY: '2' }, now), [])
    assert.equal(checkBudget('mcp', calls, { FIG_BUDGET_MCP_DAY: '1' }, now).length, 1)
  })
  test('예산: 윈도 밖 호출은 세지 않고 백엔드끼리 섞이지 않는다', () => {
    const calls = [call({ t: now - 25 * HOUR }), { backend: 'rest', kind: 'GET', name: 'files/meta', t: now - 1000 }]
    assert.deepEqual(checkBudget('mcp', calls, { FIG_BUDGET_MCP_DAY: '1' }, now), [])
    assert.equal(checkBudget('rest', calls, { FIG_BUDGET_REST_MIN: '1' }, now).length, 1)
    assert.deepEqual(checkBudget('rest', [{ backend: 'rest', kind: 'GET', name: 'files/meta', t: now - 61000 }], { FIG_BUDGET_REST_MIN: '1' }, now), [])
  })
  test('예산: 잘못된 값은 오류로 알린다', () => {
    for (const bad of ['0', '-1', 'abc', '1.5']) assert.throws(() => checkBudget('mcp', [], { FIG_BUDGET_MCP_DAY: bad }, now), /1 이상의 정수/)
  })
  test('상한 기록: MCP 는 보류 시간 안에서만, REST 는 Retry-After 안에서만 막는다', () => {
    const mcp = (ago) => [{ event: 'limit', backend: 'mcp', t: now - ago }]
    assert.equal(checkBudget('mcp', mcp(MCP_LIMIT_HOLD_MS - 1000), {}, now).length, 1)
    assert.equal(checkBudget('mcp', mcp(MCP_LIMIT_HOLD_MS + 1000), {}, now).length, 0)
    const rest = (ago, retryAfterSec) => [{ event: 'limit', backend: 'rest', retryAfterSec, t: now - ago }]
    assert.equal(checkBudget('rest', rest(10000, 30), {}, now).length, 1)
    assert.equal(checkBudget('rest', rest(31000, 30), {}, now).length, 0)
    assert.equal(checkBudget('rest', rest(59000, null), {}, now).length, 1)
    assert.equal(checkBudget('rest', rest(61000, null), {}, now).length, 0)
  })
  test('상한 기록은 다른 백엔드를 막지 않는다', () => {
    assert.deepEqual(checkBudget('rest', [{ event: 'limit', backend: 'mcp', t: now - 1000 }], {}, now), [])
  })

  test('집계: 1분·1시간·24시간 윈도로 세고 경고 문구를 붙인다', () => {
    const calls = [call({ t: now - 30000 }), call({ t: now - 10 * 60000 }), call({ t: now - 3 * HOUR }), call({ kind: 'initialize', name: null, t: now - 1000 })]
    const text = renderUsage(calls, now)
    assert.match(text, /mcp get_metadata\s+1\s+2\s+3\n/)
    assert.match(text, /mcp initialize\s+1\s+1\s+1\n/)
    assert.match(text, /다른 클라이언트 호출은 빠져 있어/)
  })
  test('반복 호출: 대상이 있는 tools/call 만, 24시간 안에서, 같은 도구·노드끼리 센다', () => {
    const hit = (name, node, ago, over = {}) => ({ backend: 'mcp', kind: 'tools/call', name, node, t: now - ago, ...over })
    const calls = [
      hit('a', '1:1', 1000), hit('a', '1:1', 2000), hit('a', '1:1', 3000),
      hit('b', '1:1', 1000), hit('a', '2:2', 1000),
      hit('a', '9:9', 25 * HOUR), hit('a', '9:9', 1000),
      hit('a', null, 1000), hit('a', null, 2000),
      hit('a', '1:1', 1000, { kind: 'initialize' }),
      { event: 'limit', backend: 'mcp', name: 'a', node: '1:1', t: now - 1000 },
      { backend: 'rest', kind: 'GET', name: 'files/meta', t: now - 1000 },
    ]
    const text = repeatLines(calls, now).join('\n')
    assert.match(text, /tools\/call 8회 중 대상 노드가 있는 6회에서 같은 도구·노드를 다시 부른 것 2회, 대상이 없는\(선택 노드\) 2회는 판정 제외/)
    assert.match(text, /a 1:1  ×3/)
    assert.doesNotMatch(text, /a 9:9|b 1:1  ×|a 2:2  ×/)
  })
  test('반복 호출: 많으면 상위 5개만 보여 주고, 기록이 없으면 0회로 알린다', () => {
    const calls = Array.from({ length: 8 }, (_, i) => [0, 1].map((k) => ({ backend: 'mcp', kind: 'tools/call', name: 't', node: `n${i}`, t: now - 1000 - k }))).flat()
    assert.equal(repeatLines(calls, now).filter((l) => l.startsWith('  ')).length, 5)
    assert.match(repeatLines([], now).join('\n'), /tools\/call 0회 중 대상 노드가 있는 0회에서 같은 도구·노드를 다시 부른 것 0회/)
  })
  test('출력 집계: stdout 만, 명령별 횟수·합계·최대, 합계 내림차순', () => {
    const o = (cmd, bytes, ago, to = 'stdout') => ({ event: 'output', to, cmd, bytes, t: now - ago })
    const text = outputLines([o('a', 10, 1000), o('a', 30, 2000), o('b', 100, 1000), o('b', 5, 1000, 'file'), o('c', 1, 25 * HOUR)], now).join('\n')
    assert.match(text, /b\s+1회\s+합계 100B\s+최대 100B\n\s+a\s+2회\s+합계 40B\s+최대 30B/)
    assert.doesNotMatch(text, /\bc\s+\d+회/)
    assert.match(outputLines([], now).join('\n'), /\(기록 없음\)/)
  })
  test('집계: 기록이 없으면 그렇게 알린다', () => {
    assert.match(renderUsage([], now), /\(기록 없음\)/)
  })
})

describe('응답 저장본 — 키·저장·조회·정리', () => {
  const withDir = (fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-resp-'))
    try { return fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
  test('responseKey: 인자 순서와 무관하고, 도구·인자·형식이 다르면 달라진다', () => {
    const k = responseKey('t', { a: 1, b: 2 }, 'text')
    assert.equal(k, responseKey('t', { b: 2, a: 1 }, 'text'))
    assert.match(k, /^[0-9a-f]{16}$/)
    assert.notEqual(k, responseKey('u', { a: 1, b: 2 }, 'text'))
    assert.notEqual(k, responseKey('t', { a: 1, b: 3 }, 'text'))
    assert.notEqual(k, responseKey('t', { a: 1, b: 2 }, 'json'))
    assert.equal(responseKey('t', undefined, 'text'), responseKey('t', {}, 'text'))
  })
  test('storeResponse·lookupResponse: 본문과 해시·시각·크기·경로를 남기고, 없으면 null 이다', () => withDir((dir) => {
    assert.equal(lookupResponse('nope', dir), null)
    storeResponse('k1', '본문', { tool: 't' }, dir, 1234)
    const meta = lookupResponse('k1', dir)
    assert.deepEqual([meta.tool, meta.at, meta.bytes, meta.file], ['t', 1234, Buffer.byteLength('본문'), path.join(dir, 'k1.txt')])
    assert.match(meta.hash, /^[0-9a-f]{64}$/)
    assert.equal(fs.readFileSync(meta.file, 'utf8'), '본문')
  }))
  test('storeResponse: 같은 키는 덮어써서 항목이 늘지 않는다', () => withDir((dir) => {
    storeResponse('k1', 'a', {}, dir, 1)
    storeResponse('k1', 'bb', {}, dir, 2)
    assert.deepEqual(fs.readdirSync(dir).sort(), ['k1.json', 'k1.txt'])
    assert.equal(lookupResponse('k1', dir).bytes, 2)
  }))
  test('storeResponse: 상한을 넘으면 오래된 것부터 지워 상한의 2/3 로 줄인다', () => withDir((dir) => {
    for (let i = 0; i < 9; i++) {
      storeResponse(`k${i}`, 'x', {}, dir, i, 9)
      const t = new Date(1_000_000 + i * 1000)
      for (const ext of ['json', 'txt']) fs.utimesSync(path.join(dir, `k${i}.${ext}`), t, t)
    }
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length, 9)
    storeResponse('k9', 'x', {}, dir, 9, 9)
    const kept = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    assert.equal(kept.length, 6)
    assert.ok(kept.includes('k9.json') && !kept.includes('k0.json') && !fs.existsSync(path.join(dir, 'k0.txt')))
    assert.ok(MAX_STORED_RESPONSES > 0)
  }))
  test('sameResponseNote: 경과 시간·해시 앞 12자·크기·저장본 경로를 한 줄로 낸다', () => {
    const note = sameResponseNote({ at: 0, hash: 'a'.repeat(64), bytes: 2500, file: '/x/y.txt' }, 5 * 60000)
    assert.equal(note.includes('\n'), false)
    for (const part of ['5분 전', 'sha256 aaaaaaaaaaaa', '2500B', '/x/y.txt', '--full']) assert.ok(note.includes(part), part)
  })
})

describe('파일 키·토큰·REST meta', () => {
  test('parseFileKey: URL·브랜치 URL·키', () => {
    assert.equal(parseFileKey('https://www.figma.com/design/ZsugR6FJKIGjbKBv7DLdiZ/-DM--Widget-Studio?node-id=7327-61763&m=dev'), 'ZsugR6FJKIGjbKBv7DLdiZ')
    assert.equal(parseFileKey('https://www.figma.com/file/abcDEF1234xyz/Name'), 'abcDEF1234xyz')
    assert.equal(parseFileKey('https://www.figma.com/board/boardKEY12345/Name'), 'boardKEY12345')
    assert.equal(parseFileKey('https://www.figma.com/design/mainKEY12345/branch/branchKEY123/Name'), 'branchKEY123')
    assert.equal(parseFileKey('hb1q5e319upKpnNjtJzbQs'), 'hb1q5e319upKpnNjtJzbQs')
  })
  test('parseFileKey: 읽을 수 없는 입력은 받는 형식을 알린다', () => {
    assert.throws(() => parseFileKey('https://example.com/x'), /파일 키를 못 읽었다/)
    assert.throws(() => parseFileKey(''), /파일 키를 못 읽었다/)
    assert.throws(() => parseFileKey('짧은'), /파일 키를 못 읽었다/)
  })

  const withDir = (fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-test-'))
    try { return fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }
  test('readToken: 환경변수가 파일보다 앞선다', () => withDir((dir) => {
    fs.writeFileSync(path.join(dir, 'token'), Buffer.from('from-file').toString('base64'))
    assert.equal(readToken({ FIGMA_TOKEN: ' from-env ' }, dir), 'from-env')
  }))
  test('readToken: 환경변수가 없으면 base64 파일을 푼다(앞뒤 공백·줄바꿈 제거)', () => withDir((dir) => {
    fs.writeFileSync(path.join(dir, 'token'), `${Buffer.from('from-file').toString('base64')}\n`)
    assert.equal(readToken({}, dir), 'from-file')
  }))
  test('readToken: 아무것도 없으면 null', () => withDir((dir) => {
    assert.equal(readToken({}, dir), null)
    assert.equal(readToken({ FIGMA_TOKEN: '  ' }, dir), null)
  }))

  const TOKEN = 'figd_UNIT_TOKEN_0123456789'
  const withRest = async (handler, fn) => {
    const server = Bun.serve({ port: 0, fetch: handler })
    const before = process.env.FIG_REST_URL
    process.env.FIG_REST_URL = `http://127.0.0.1:${server.port}`
    try { return await fn() } finally {
      if (before === undefined) delete process.env.FIG_REST_URL
      else process.env.FIG_REST_URL = before
      server.stop(true)
    }
  }
  test('fetchFileMeta: 마지막 편집 기록과 이름을 읽고 토큰을 X-Figma-Token 으로 보낸다', async () => {
    let seen
    const handler = (req) => { seen = [new URL(req.url).pathname, req.headers.get('x-figma-token')]; return Response.json({ file: { name: 'N', last_touched_at: 'T1' } }) }
    const got = await withRest(handler, () => fetchFileMeta('KEY1234567', TOKEN, 5000))
    assert.deepEqual(got, { lastTouchedAt: 'T1', name: 'N' })
    assert.deepEqual(seen, ['/v1/files/KEY1234567/meta', TOKEN])
  })
  test('fetchFileMeta: 상태 코드별 한국어 오류, 오류 메시지에 토큰이 들어가지 않는다', async () => {
    for (const [status, pattern] of [[401, /토큰이 무효/], [403, /토큰이 무효/], [404, /파일을 찾지 못했다/], [500, /HTTP 500/]]) {
      const err = await withRest(() => new Response('{}', { status }), () => fetchFileMeta('KEY1234567', TOKEN, 5000).catch((e) => e))
      assert.match(err.message, pattern)
      assert.equal(err.message.includes(TOKEN), false)
    }
  })
  test('fetchFileMeta: 429 는 Retry-After 를 알린다', async () => {
    const err = await withRest(() => new Response('{}', { status: 429, headers: { 'retry-after': '42' } }), () => fetchFileMeta('KEY1234567', TOKEN, 5000).catch((e) => e))
    assert.match(err.message, /HTTP 429, Retry-After 42초/)
  })
  test('fetchFileMeta: last_touched_at 이 없는 응답은 오류다', async () => {
    const err = await withRest(() => Response.json({ file: {} }), () => fetchFileMeta('KEY1234567', TOKEN, 5000).catch((e) => e))
    assert.match(err.message, /last_touched_at/)
  })
  test('fetchFileMeta: 응답이 없으면 대기 상한을 알리고, 연결이 안 되면 연결 실패를 알린다', async () => {
    const hang = await withRest(() => new Promise(() => {}), () => fetchFileMeta('KEY1234567', TOKEN, 300).catch((e) => e))
    assert.match(hang.message, /안에 응답이 오지 않았다/)
    const server = Bun.serve({ port: 0, fetch: () => new Response('x') })
    const port = server.port
    server.stop(true)
    const before = process.env.FIG_REST_URL
    process.env.FIG_REST_URL = `http://127.0.0.1:${port}`
    try {
      const refused = await fetchFileMeta('KEY1234567', TOKEN, 2000).catch((e) => e)
      assert.match(refused.message, /연결하지 못했다/)
    } finally {
      if (before === undefined) delete process.env.FIG_REST_URL
      else process.env.FIG_REST_URL = before
    }
  })
})

describe('isFreshIndex — 색인을 서버 확인 없이 믿는 시간', () => {
  const now = 1_000_000_000
  test('5분 미만이면 믿는다', () => {
    assert.equal(isFreshIndex(now - 60000, now), true)
    assert.equal(isFreshIndex(now, now), true)
  })
  test('5분 이상이면 확인한다', () => {
    assert.equal(isFreshIndex(now - INDEX_TRUST_MS, now), false)
    assert.equal(isFreshIndex(now - 6 * 60000, now), false)
  })
  test('만든 시각이 미래이면(시계 어긋남) 믿지 않는다', () => {
    assert.equal(isFreshIndex(now + 1000, now), false)
  })
})
