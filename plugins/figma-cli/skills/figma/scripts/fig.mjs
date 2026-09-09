#!/usr/bin/env node
// fig — Figma 데스크톱 앱의 Dev Mode MCP 서버(http://127.0.0.1:3845/mcp)를 셸에서 쓰는 CLI.
//
// MCP 도구로 직접 부르는 대신 CLI 를 두는 이유: get_design_context 한 노드가 65KB 라
// 대화 컨텍스트에 통째로 들어간다. 파일로 받아 grep 하면 필요한 줄만 본다.
//
// 의존성 없음 — node 18+ 의 fetch/Buffer 만 쓴다.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const ENDPOINT = process.env.FIG_MCP_URL || 'http://127.0.0.1:3845/mcp'
const CACHE_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'fig')
const CACHE_FILE = path.join(CACHE_DIR, 'session')

// ── 인자 파싱 ────────────────────────────────────────────────────────────────

// URL·7327-61763·7327:61763 을 서버가 받는 nodeId 로. 서버 스키마는 ^\d+[:-]\d+$ 라
// 하이픈도 그대로 통과하지만, 출력에 찍히는 id 와 맞추려고 콜론으로 정규화한다.
export function parseNodeId(input) {
  if (input == null || input === '') return null
  const s = String(input).trim()
  const m = /[?&]node-id=([^&#]+)/.exec(s)
  const raw = m ? decodeURIComponent(m[1]) : s
  if (!/^\d+[:-]\d+$/.test(raw)) {
    throw new Error(`노드 id 를 못 읽었다: ${input}\n` +
      '  받는 형식: Figma URL(?node-id=7327-61763) · 7327-61763 · 7327:61763')
  }
  return raw.replace('-', ':')
}

// ── MCP 세션 ─────────────────────────────────────────────────────────────────

const HEADERS = (sid) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  ...(sid ? { 'mcp-session-id': sid } : {}),
})

// fetch 가 응답 없이 실패하면 원인이 무엇이든 서버에 못 닿은 것이다 — 종류를 가리지 않고
// 같은 안내를 낸다. 원인 코드는 진단용으로 괄호에 남긴다.
function friendlyConnError(err) {
  const detail = err?.cause?.code || err?.cause?.message || err?.code || err?.name
  if (err?.name === 'TypeError' || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new Error(
      `${ENDPOINT} 에 연결하지 못했다 (${detail}).\n` +
      '  1) Figma 데스크톱 앱이 떠 있는지 확인한다 — 브라우저 버전에는 이 서버가 없다.\n' +
      '  2) Figma 메뉴 → Preferences → Enable local MCP server 를 켠다.\n' +
      '  3) 디자인 파일 탭을 하나 열어 활성 탭으로 둔다.\n' +
      `  포트 확인: lsof -nP -iTCP:${new URL(ENDPOINT).port} -sTCP:LISTEN`)
  }
  return err
}

async function post(sid, body, timeoutMs) {
  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: HEADERS(sid),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw friendlyConnError(err)
  }
  return { status: res.status, sid: res.headers.get('mcp-session-id'), text: await res.text() }
}

// 응답은 text/event-stream 이라 `data: ` 줄만 이어 붙이면 JSON 하나가 된다.
export function parseSse(text) {
  const data = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
  return JSON.parse(data || text)
}

function readCachedSid() {
  try { return fs.readFileSync(CACHE_FILE, 'utf8').trim() || null } catch { return null }
}

function writeCachedSid(sid) {
  // ponytail: 캐시는 세션 id 한 줄뿐이고 잠금이 없다. 여러 fig 가 동시에 쓰면
  // 마지막 것이 이기지만, 진 쪽은 다음 호출에서 404 → 재초기화로 스스로 복구한다.
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(CACHE_FILE, `${sid}\n`)
  } catch { /* 캐시는 최적화일 뿐이라 실패해도 진행한다 */ }
}

async function initialize() {
  const res = await post(null, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'fig', version: '1' },
    },
  }, 10000)
  const sid = res.sid
  if (!sid) throw new Error(`initialize 가 mcp-session-id 를 주지 않았다 (HTTP ${res.status}): ${res.text.slice(0, 200)}`)
  await post(sid, { jsonrpc: '2.0', method: 'notifications/initialized' }, 10000)
  writeCachedSid(sid)
  return sid
}

// 세션은 서버 재시작·만료로 언제든 죽는다. TTL 을 알 필요 없이 404 를 보고 다시 잡는다.
async function rpc(method, params, { noCache = false, timeoutMs = 120000 } = {}) {
  let sid = noCache ? await initialize() : (readCachedSid() || await initialize())
  let res = await post(sid, { jsonrpc: '2.0', id: 2, method, params }, timeoutMs)
  if (res.status === 404) {
    sid = await initialize()
    res = await post(sid, { jsonrpc: '2.0', id: 2, method, params }, timeoutMs)
  }
  const json = parseSse(res.text)
  if (json.error) throw new Error(`${json.error.message} (code ${json.error.code})`)
  return json.result
}

export async function callTool(name, args, opts) {
  const result = await rpc('tools/call', { name, arguments: args }, opts)
  if (result.isError) {
    const msg = (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    throw new Error(msg || `${name} 호출이 실패했다`)
  }
  return result
}

export const textOf = (result) =>
  (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')

export const imagesOf = (result) => (result.content || []).filter((b) => b.type === 'image')

// ── get_metadata XML 파싱 ────────────────────────────────────────────────────
//
// 서버가 내는 XML 은 한 줄에 요소 하나, 들여쓰기 2칸, 속성은 id·name·x·y·width·height·hidden
// 뿐이다(2.6MB 문서 전량으로 확인). name 에 따옴표가 들어와도 깨지지 않게, name 은
// 앞뒤 고정 속성 사이를 잘라 읽는다.
// 이름에 실제로 오는 엔티티는 &gt; 뿐이지만(문서 전량 확인), 나머지도 같이 푼다.
const unescapeXml = (s) => s.replace(/&(gt|lt|amp|quot|apos);/g,
  (_, e) => ({ gt: '>', lt: '<', amp: '&', quot: '"', apos: "'" })[e])

export function parseMetadata(xml) {
  const nodes = []
  const stack = []
  for (const line of xml.split('\n')) {
    const m = /^(\s*)<(\/?)([\w-]+)(.*?)(\/?)>\s*$/.exec(line)
    if (!m) continue
    const [, indent, closing, type, attrText, selfClosing] = m
    const depth = indent.length / 2
    if (closing) { stack.length = depth; continue }

    const id = /\bid="([^"]*)"/.exec(attrText)?.[1] ?? ''
    const nameMatch = /\bname="(.*)" x="/.exec(attrText)
    const name = unescapeXml(nameMatch ? nameMatch[1] : (/\bname="([^"]*)"/.exec(attrText)?.[1] ?? ''))
    const num = (k) => {
      const v = new RegExp(`\\b${k}="([^"]*)"`).exec(attrText)?.[1]
      return v === undefined ? null : Number(v)
    }
    const node = {
      id, type, name, depth,
      x: num('x'), y: num('y'), width: num('width'), height: num('height'),
      hidden: /\bhidden="true"/.test(attrText),
      path: [...stack.slice(0, depth), name],
    }
    nodes.push(node)
    stack[depth] = name
    if (!selfClosing) stack.length = depth + 1
  }
  return nodes
}

const fmtNode = (n) => {
  // document·canvas 는 좌표와 크기가 전부 0 이라 찍어봐야 잡음이다.
  const box = n.width || n.height || n.x || n.y ? ` ${n.width}×${n.height} @${n.x},${n.y}` : ''
  return `${n.name || '(이름없음)'}  [${n.type} ${n.id}]${box}${n.hidden ? ' (숨김)' : ''}`
}

export function renderTree(nodes, { depth = 2, hidden = false } = {}) {
  return nodes
    .filter((n) => n.depth <= depth && (hidden || !n.hidden))
    .map((n) => `${'  '.repeat(n.depth)}${fmtNode(n)}`)
    .join('\n')
}

export function findNodes(nodes, pattern, { hidden = false } = {}) {
  const re = new RegExp(pattern, 'i')
  return nodes.filter((n) => (hidden || !n.hidden) && re.test(n.name))
}

const renderFind = (hits) =>
  hits.map((n) => `${fmtNode(n)}  ← ${n.path.slice(0, -1).join(' / ') || '(루트)'}`).join('\n')

// ── 출력 ─────────────────────────────────────────────────────────────────────

function emit(text, out) {
  if (out) {
    fs.writeFileSync(out, text.endsWith('\n') ? text : `${text}\n`)
    process.stderr.write(`${out} (${Buffer.byteLength(text)} 바이트)\n`)
  } else {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
  }
}

const HELP = `fig — Figma Dev Mode MCP 를 셸에서 쓰는 CLI

사용법: fig <명령> [대상] [옵션]

명령
  ctx   [대상]          디자인 컨텍스트(참조 코드·토큰). get_design_context
  meta  [대상]          노드 트리 메타데이터 XML. get_metadata
  shot  [대상]          PNG 스크린샷. get_screenshot
  vars  [대상]          변수 정의. get_variable_defs
  tree  [대상]          메타데이터를 요약 트리로 (대상 기본값 0:0 = 문서 루트)
  find  <패턴> [대상]   노드 이름을 정규식으로 검색, 조상 경로까지 출력
  tools                 서버가 제공하는 도구 목록과 인자
  call  <도구> [JSON]   도구를 이름으로 직접 호출 (위에 없는 도구용)

대상
  Figma URL 을 그대로 붙여넣거나(?node-id=7327-61763), 7327-61763,
  7327:61763 을 준다. 생략하면 Figma 에서 지금 선택한 노드를 쓴다.

옵션
  -o, --out FILE   stdout 대신 파일로 쓴다 (shot 은 생략 시 fig-<id>.png)
  --json           구조화 출력 (tree·find·meta)
  -d, --depth N    tree 깊이, 기본 2
  --hidden         숨김 노드도 포함 (기본은 제외)
  --raw            서버 응답(JSON-RPC result)을 그대로 낸다
  --no-cache       캐시된 세션을 쓰지 않고 새로 initialize 한다
  -h, --help       이 도움말

예시
  fig tree                                        # 캔버스 목록
  fig find 'modalHeader'                          # 이름으로 노드 찾기
  fig meta 'https://figma.com/design/…?node-id=7327-61763'
  fig ctx 7327-61763 -o header.tsx                # 65KB 를 파일로 받아 grep
  fig shot 7327-61763 -o header.png
  fig call get_figjam '{"nodeId":"1:2"}'

환경변수
  FIG_MCP_URL   MCP 엔드포인트, 기본 http://127.0.0.1:3845/mcp
`

// ── main ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = { json: false, raw: false, hidden: false, noCache: false, depth: 2, out: null, help: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') opts.help = true
    else if (a === '--json') opts.json = true
    else if (a === '--raw') opts.raw = true
    else if (a === '--hidden') opts.hidden = true
    else if (a === '--no-cache') opts.noCache = true
    else if (a === '-o' || a === '--out') opts.out = argv[++i]
    else if (a === '-d' || a === '--depth') opts.depth = Number(argv[++i])
    else if (a.startsWith('-') && a !== '-') throw new Error(`모르는 옵션: ${a} (fig --help)`)
    else positional.push(a)
  }
  if (opts.depth != null && Number.isNaN(opts.depth)) throw new Error('--depth 에는 숫자를 준다')
  return { opts, positional }
}

async function metadataNodes(target, opts) {
  const nodeId = parseNodeId(target) || '0:0'
  const result = await callTool('get_metadata', { nodeId }, opts)
  return parseMetadata(textOf(result))
}

export async function main(argv) {
  const { opts, positional } = parseArgs(argv)
  const [cmd, ...rest] = positional
  // --help 는 성공, 인자 없이 부른 것은 실패다.
  if (opts.help || !cmd) { process.stdout.write(HELP); return opts.help ? 0 : 1 }

  const nodeArgs = (target) => {
    const nodeId = parseNodeId(target)
    return nodeId ? { nodeId } : {}
  }

  switch (cmd) {
    case 'ctx': {
      // 스크린샷 블록은 텍스트 파이프에 쓸모가 없다 — 그림이 필요하면 fig shot.
      const r = await callTool('get_design_context', {
        ...nodeArgs(rest[0]), clientLanguages: 'unknown', clientFrameworks: 'unknown', excludeScreenshot: true,
      }, opts)
      emit(opts.raw ? JSON.stringify(r, null, 2) : textOf(r), opts.out)
      return 0
    }
    case 'meta': {
      const r = await callTool('get_metadata', nodeArgs(rest[0]), opts)
      const text = opts.raw ? JSON.stringify(r, null, 2)
        : opts.json ? JSON.stringify(parseMetadata(textOf(r)), null, 2)
        : textOf(r)
      emit(text, opts.out)
      return 0
    }
    case 'vars': {
      const r = await callTool('get_variable_defs', nodeArgs(rest[0]), opts)
      emit(opts.raw ? JSON.stringify(r, null, 2) : textOf(r), opts.out)
      return 0
    }
    case 'shot': {
      const r = await callTool('get_screenshot', nodeArgs(rest[0]), opts)
      const images = imagesOf(r)
      if (!images.length) throw new Error(`스크린샷이 오지 않았다: ${textOf(r).slice(0, 200)}`)
      const ext = (images[0].mimeType || 'image/png').split('/')[1]
      const out = opts.out || `fig-${(parseNodeId(rest[0]) || 'selection').replace(':', '-')}.${ext}`
      const buf = Buffer.from(images[0].data, 'base64')
      fs.writeFileSync(out, buf)
      process.stderr.write(`${out} (${buf.length} 바이트, ${images[0].mimeType})\n`)
      return 0
    }
    case 'tree': {
      const nodes = await metadataNodes(rest[0], opts)
      emit(opts.json ? JSON.stringify(nodes.filter((n) => n.depth <= opts.depth && (opts.hidden || !n.hidden)), null, 2)
        : renderTree(nodes, opts), opts.out)
      return 0
    }
    case 'find': {
      if (!rest[0]) throw new Error('검색할 이름 패턴을 준다: fig find <패턴> [대상]')
      const hits = findNodes(await metadataNodes(rest[1], opts), rest[0], opts)
      if (!hits.length) { process.stderr.write(`일치하는 노드가 없다: ${rest[0]}\n`); return 1 }
      emit(opts.json ? JSON.stringify(hits, null, 2) : renderFind(hits), opts.out)
      return 0
    }
    case 'tools': {
      const r = await rpc('tools/list', {}, opts)
      if (opts.raw) { emit(JSON.stringify(r, null, 2), opts.out); return 0 }
      emit(r.tools.map((t) => {
        const props = Object.entries(t.inputSchema?.properties || {})
        const req = new Set(t.inputSchema?.required || [])
        return `${t.name}\n${props.map(([k, v]) => `  ${req.has(k) ? '*' : ' '} ${k}: ${v.type}`).join('\n')}`
      }).join('\n'), opts.out)
      return 0
    }
    case 'call': {
      if (!rest[0]) throw new Error('도구 이름을 준다: fig call <도구> [JSON] (목록: fig tools)')
      let args
      try { args = rest[1] ? JSON.parse(rest[1]) : {} } catch (e) { throw new Error(`인자 JSON 을 못 읽었다: ${e.message}`) }
      const r = await callTool(rest[0], args, opts)
      emit(opts.raw ? JSON.stringify(r, null, 2) : textOf(r), opts.out)
      return 0
    }
    default:
      throw new Error(`모르는 명령: ${cmd} (fig --help)`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => { process.stderr.write(`fig: ${err?.message || err}\n`); process.exit(1) })
}
