// bun test plugins/figma-cli/tests/
//
// 고정 입력은 실제 서버 응답에서 잘라 온 것이다(2026-09-09, [DM] Widget Studio).

import { test, describe } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parseNodeId, parseSse, parseMetadata, renderTree, findNodes, parseArgs,
  splitServerNotes, codeConnectOnlyError, timeoutError, describeServerError,
  limitHits, parseSquare, agoText, sameNode, writeIndex, readIndex, isFreshIndex, INDEX_TRUST_MS }
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

  const run = async (toolResult, args, { viaShellPipe = false, prepare = null } = {}) => {
    let calls = 0
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json()
        if (body.method === 'initialize') return sse({ jsonrpc: '2.0', id: body.id, result: {} }, 'S')
        if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
        calls += 1
        return sse({ jsonrpc: '2.0', id: body.id, result: toolResult })
      },
    })
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-test-'))
    try {
      prepare?.(path.join(cache, 'fig'))
      const command = viaShellPipe
        ? ['sh', '-c', '"$0" "$@" | cat', process.execPath, FIG, ...args]
        : [process.execPath, FIG, ...args]
      const proc = Bun.spawn(command, {
        env: { ...process.env, FIG_MCP_URL: `http://127.0.0.1:${server.port}/mcp`, XDG_CACHE_HOME: cache },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [out, err, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited])
      return { bytes: out.byteLength, out: Buffer.from(out).toString('utf8'), err, code, calls }
    } finally {
      server.stop(true)
      fs.rmSync(cache, { recursive: true, force: true })
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
  const indexBuiltAt = (builtAt) => (dir) => writeIndex(FILTER_XML, filterNodes, dir, builtAt)

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
