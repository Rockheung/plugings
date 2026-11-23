#!/usr/bin/env bun
// fig — Figma 데스크톱 앱의 Dev Mode MCP 서버(http://127.0.0.1:3845/mcp)를 셸에서 쓰는 CLI.
//
// MCP 도구로 직접 부르는 대신 CLI 를 두는 이유: get_design_context 한 노드가 65KB 라
// 대화 컨텍스트에 통째로 들어간다. 파일로 받아 grep 하면 필요한 줄만 본다.
//
// 의존성 없음 — bun 의 fetch/Buffer 만 쓴다.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

export const ENDPOINT = process.env.FIG_MCP_URL || 'http://127.0.0.1:3845/mcp'
const CACHE_DIR = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'fig')
const CACHE_FILE = path.join(CACHE_DIR, 'session')
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'fig')
const stateDir = () => path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'fig')

// ── 호출 원장 ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
export const MCP_LIMIT_HOLD_MS = 60 * 60 * 1000
const BUDGETS = {
  mcp: { env: 'FIG_BUDGET_MCP_DAY', windowMs: DAY_MS, label: 'MCP 읽기 호출(최근 24시간)', name: 'MCP' },
  rest: { env: 'FIG_BUDGET_REST_MIN', windowMs: 60 * 1000, label: 'REST 호출(최근 1분)', name: 'REST' },
}
let currentCommand = null

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)

export function recordCall(entry, dir = stateDir(), now = Date.now()) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, `calls-${utcDay(now)}.jsonl`), `${JSON.stringify({ t: now, cmd: currentCommand, ...entry })}\n`)
  } catch (err) {
    process.stderr.write(`fig: 호출 원장에 기록하지 못했다 — ${err.message}\n`)
  }
}

export function readCalls(sinceMs, dir = stateDir(), now = Date.now()) {
  const days = new Set([utcDay(now)])
  for (let t = sinceMs; t < now; t += 6 * 60 * 60 * 1000) days.add(utcDay(t))
  const calls = []
  for (const day of days) {
    let text
    try { text = fs.readFileSync(path.join(dir, `calls-${day}.jsonl`), 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      try {
        const entry = JSON.parse(line)
        if (entry.t >= sinceMs && entry.t <= now) calls.push(entry)
      } catch {}
    }
  }
  return calls.sort((a, b) => a.t - b.t)
}

const isRequest = (c) => !c.event
const isExecutedCall = (c) => isRequest(c) && c.kind === 'tools/call' && c.http !== 404
const isBudgeted = (c) => isRequest(c) && (c.backend === 'rest' || isExecutedCall(c))

export function checkBudget(backend, calls, env = process.env, now = Date.now()) {
  const budget = BUDGETS[backend]
  const reasons = []
  const raw = env[budget.env]
  if (raw !== undefined && raw !== '') {
    const limit = Number(raw)
    if (!Number.isInteger(limit) || limit <= 0) throw new Error(`${budget.env} 에는 1 이상의 정수를 준다: ${raw}`)
    const used = calls.filter((c) => c.backend === backend && isBudgeted(c) && c.t > now - budget.windowMs).length
    if (used >= limit) reasons.push(`${budget.label} ${used}회를 이 CLI 가 보냈고 설정한 예산 ${limit}회에 도달했다 (${budget.env})`)
  }
  const hit = calls.filter((c) => c.backend === backend && c.event === 'limit').at(-1)
  if (hit) {
    const holdMs = backend === 'rest' ? (hit.retryAfterSec ?? 60) * 1000 : MCP_LIMIT_HOLD_MS
    if (now < hit.t + holdMs) {
      const hold = backend === 'rest' ? `Retry-After ${hit.retryAfterSec ?? 60}초` : `${MCP_LIMIT_HOLD_MS / 60000}분 동안 보류`
      reasons.push(`${agoText(now - hit.t)} 서버가 ${budget.name} 호출 상한을 알렸다 (${hold}, 남은 ${Math.ceil((hit.t + holdMs - now) / 1000)}초)`)
    }
  }
  return reasons
}

function guard(backend, opts) {
  const now = Date.now()
  const reasons = checkBudget(backend, readCalls(now - DAY_MS, stateDir(), now), process.env, now)
  if (!reasons.length) return
  const lines = reasons.map((r) => `  - ${r}`).join('\n')
  if (!opts?.force) {
    throw new Error(`호출 예산 때문에 ${BUDGETS[backend].name} 호출을 보내지 않았다.\n${lines}\n  그래도 보내려면 --force 를 준다. 집계는 fig usage.`)
  }
  process.stderr.write(`fig: 예산 경고가 있지만 --force 라서 보낸다\n${lines}\n`)
}

export function repeatLines(calls, now = Date.now()) {
  const recent = calls.filter((c) => isExecutedCall(c) && c.t > now - DAY_MS)
  const targeted = recent.filter((c) => c.node)
  const counts = new Map()
  for (const c of targeted) counts.set(`${c.name} ${c.node}`, (counts.get(`${c.name} ${c.node}`) ?? 0) + 1)
  const repeated = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const again = targeted.length - counts.size
  return [
    '',
    `반복 호출(최근 24시간) — tools/call ${recent.length}회 중 대상 노드가 있는 ${targeted.length}회에서 같은 도구·노드를 다시 부른 것 ${again}회, 대상이 없는(선택 노드) ${recent.length - targeted.length}회는 판정 제외`,
    ...repeated.slice(0, 5).map(([k, n]) => `  ${k}  ×${n}`),
  ]
}

export function outputLines(calls, now = Date.now()) {
  const byCommand = new Map()
  for (const c of calls.filter((e) => e.event === 'output' && e.to === 'stdout' && e.t > now - DAY_MS)) {
    const row = byCommand.get(c.cmd) ?? { n: 0, sum: 0, max: 0 }
    row.n += 1; row.sum += c.bytes; row.max = Math.max(row.max, c.bytes)
    byCommand.set(c.cmd, row)
  }
  const rows = [...byCommand].sort((a, b) => b[1].sum - a[1].sum)
  return [
    '',
    '대화로 나간 출력(최근 24시간, stdout) — 명령별 횟수·합계·최대',
    ...(rows.length ? rows.map(([cmd, r]) => `  ${String(cmd).padEnd(8)} ${String(r.n).padStart(4)}회  합계 ${r.sum}B  최대 ${r.max}B`) : ['  (기록 없음)']),
    '  -o 로 파일에 쓴 출력은 세지 않는다. 바이트 수이며 토큰 수가 아니다.',
  ]
}

export function renderUsage(calls, now = Date.now()) {
  const windows = [60 * 1000, 60 * 60 * 1000, DAY_MS]
  const rows = new Map()
  for (const c of calls.filter(isRequest)) {
    const key = `${c.backend} ${c.backend === 'mcp' && c.kind !== 'tools/call' ? c.kind : c.name}`
    const row = rows.get(key) ?? [0, 0, 0]
    windows.forEach((w, i) => { if (c.t > now - w) row[i] += 1 })
    rows.set(key, row)
  }
  const width = Math.max(8, ...[...rows.keys()].map((k) => k.length))
  const table = [...rows].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, r]) => `${k.padEnd(width)}  ${r.map((n) => String(n).padStart(6)).join('')}`)
  const limitLine = (backend) => {
    const hit = calls.filter((c) => c.backend === backend && c.event === 'limit').at(-1)
    return `${backend}: ${hit ? `${agoText(now - hit.t)} 서버가 상한을 알렸다` : '없음'}`
  }
  const budgetLine = (backend) => `${BUDGETS[backend].env}=${process.env[BUDGETS[backend].env] || '(설정 없음)'}`
  return [
    `${'호출(이 CLI 가 보낸 요청)'.padEnd(width)}    1분  1시간 24시간`,
    ...(table.length ? table : ['(기록 없음)']),
    '',
    `마지막 상한 통지 — ${limitLine('mcp')} | ${limitLine('rest')}`,
    `예산 — ${budgetLine('mcp')} | ${budgetLine('rest')}`,
    ...repeatLines(calls, now),
    ...outputLines(calls, now),
    '',
    '예산에 세는 요청: MCP tools/call(세션 만료 404 제외), REST 전부. initialize·tools/list 는 기록만 한다.',
    '이 CLI 가 보낸 요청만 센다. 같은 계정의 다른 클라이언트 호출은 빠져 있어 서버가 센 양은 이보다 많을 수 있다.',
    '하루 기준은 최근 24시간이다. 서버가 하루를 언제 새로 시작하는지는 알 수 없다.',
  ].join('\n')
}

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

export const DEFAULT_TIMEOUT_MS = 15000

export function timeoutError(label, timeoutMs) {
  return new Error(
    `${label} 응답이 ${timeoutMs / 1000}초 안에 오지 않았다.\n` +
    '  다른 명령(fig meta · vars)은 응답하는데 이 도구만 멈추는 경우가 있다 — 그 둘이 응답하는지 먼저 본다.\n' +
    '  오래 걸리는 노드면 --timeout 초 로 늘린다.')
}

function friendlyConnError(err) {
  const detail = err?.cause?.code || err?.cause?.message || err?.code || err?.name
  if (err?.name === 'TypeError') {
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
  const started = Date.now()
  const isCall = body.method === 'tools/call'
  const entry = { backend: 'mcp', kind: body.method, name: body.params?.name ?? null, ...(isCall && { node: body.params?.arguments?.nodeId ?? null }) }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: HEADERS(sid),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    recordCall({ ...entry, http: res.status, ms: Date.now() - started, bytes: Buffer.byteLength(text) })
    return { status: res.status, sid: res.headers.get('mcp-session-id'), text }
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    recordCall({ ...entry, http: null, ms: Date.now() - started, error: timedOut ? 'timeout' : 'connect' })
    if (timedOut) throw timeoutError(body.params?.name || body.method, timeoutMs)
    throw friendlyConnError(err)
  }
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
async function rpc(method, params, { noCache = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let sid = noCache ? await initialize() : (readCachedSid() || await initialize())
  let res = await post(sid, { jsonrpc: '2.0', id: 2, method, params }, timeoutMs)
  if (res.status === 404) {
    sid = await initialize()
    res = await post(sid, { jsonrpc: '2.0', id: 2, method, params }, timeoutMs)
  }
  const json = parseSse(res.text)
  if (json.error) throw describeServerError(json.error.message, json.error.code)
  return json.result
}

const RATE_LIMIT_DOC = 'https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/'

export function describeServerError(message, code) {
  const original = code === undefined ? message : `${message} (code ${code})`
  if (/only available if your active tab is a design or FigJam file/i.test(message)) {
    return new Error('Figma 의 활성 탭이 디자인·FigJam 파일이 아니다 — 파일 탭을 하나 열어 활성 탭으로 둔다.\n' +
      `  (서버 응답: ${original})`)
  }
  if (/rate limit exceeded/i.test(message)) {
    return Object.assign(new Error('Figma MCP 읽기 호출 상한에 걸렸다 — 풀릴 때까지 meta·ctx·vars·shot·find·tree 가 막힌다(fig tools 는 상한을 받지 않았다).\n' +
      `  같은 호출을 되풀이하지 않는다. 시트·플랜별 상한과 면제 도구는 ${RATE_LIMIT_DOC} 에 있다.\n` +
      `  (서버 응답: ${original})`), { rateLimited: true })
  }
  return new Error(original)
}

export async function callTool(name, args, opts) {
  guard('mcp', opts)
  try {
    const result = await rpc('tools/call', { name, arguments: args }, opts)
    if (result.isError) {
      const msg = (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      throw describeServerError(msg || `${name} 호출이 실패했다`)
    }
    return result
  } catch (err) {
    if (err.rateLimited) recordCall({ event: 'limit', backend: 'mcp', name })
    throw err
  }
}

export const textOf = (result) =>
  (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')

export const imagesOf = (result) => (result.content || []).filter((b) => b.type === 'image')

const isCodeConnectPrompt = (text) => /missing code connect mappings/i.test(text)

export function splitServerNotes(result) {
  const blocks = result.content || []
  const texts = blocks.filter((b) => b.type === 'text').map((b) => b.text)
  if (blocks[0]?.type !== 'text' || isCodeConnectPrompt(texts[0])) return { text: '', notes: texts }
  const [text, ...notes] = texts
  return { text, notes }
}

export function codeConnectOnlyError(args) {
  const retry = JSON.stringify({ ...args, forceCode: true })
  return new Error(
    '서버가 디자인 코드를 주지 않고 Code Connect 연결 안내만 보냈다.\n' +
    '  안내문이 시키는 disableCodeConnect 는 서버 도구 스키마(fig tools)에 없는 인자다.\n' +
    '  스키마의 forceCode 는 출력이 커서 메타데이터만 올 때 코드를 강제하는 인자이고, 이 응답에 듣는지는 확인하지 못했다:\n' +
    `  fig call get_design_context '${retry}'\n` +
    '  원문은 --raw 로 확인한다.')
}

function presentText(result, opts, args) {
  if (opts.raw) return JSON.stringify(result, null, 2)
  const { text, notes } = splitServerNotes(result)
  if (notes.length) process.stderr.write(`fig: 서버가 붙인 안내 문구 ${notes.length}개는 뺐다 (--raw 로 전체)\n`)
  if (!text.trim() && notes.length && args) throw codeConnectOnlyError(args)
  const images = imagesOf(result).length
  if (images) process.stderr.write(`fig: 응답에 이미지 ${images}개가 있다 — 그림은 fig shot 으로 받는다\n`)
  return text
}

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

export function findNodes(nodes, pattern, { hidden = false, type = null, prop = null, square = null } = {}) {
  const re = new RegExp(pattern, 'i')
  return nodes.filter((n) => (hidden || !n.hidden) && re.test(n.name)
    && (!type || n.type === type)
    && (!prop || n.name.split(', ').includes(prop))
    && (!square || (n.width === n.height && n.width >= square[0] && n.width <= square[1])))
}

export const DEFAULT_FIND_LIMIT = 50

export function limitHits(hits, limit) {
  if (!limit || hits.length <= limit) return { shown: hits, more: 0 }
  return { shown: hits.slice(0, limit), more: hits.length - limit }
}

export function parseSquare(text) {
  const m = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(text ?? '')
  if (!m) throw new Error('--square 에는 크기(24) 또는 범위(8-48)를 준다')
  const [min, max] = [Number(m[1]), Number(m[2] ?? m[1])]
  if (min > max) throw new Error('--square 범위는 작은 값-큰 값 순서로 준다')
  return [min, max]
}

const renderFind = (hits) =>
  hits.map((n) => `${fmtNode(n)}  ← ${n.path.slice(0, -1).join(' / ') || '(루트)'}`).join('\n')

const INDEX_XML = 'index.xml.gz'
const INDEX_META = 'index.json'

export function agoText(ms) {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`
}

export const sameNode = (a, b) =>
  ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'hidden'].every((k) => a[k] === b[k])

export function parseFileKey(input) {
  const text = String(input ?? '').trim()
  const url = /figma\.com\/(?:design|file|board|slides)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/.exec(text)
  if (url) return url[2] ?? url[1]
  if (/^[A-Za-z0-9]{10,}$/.test(text)) return text
  throw new Error(`파일 키를 못 읽었다: ${input}\n  받는 형식: Figma 파일 URL(https://www.figma.com/design/<파일키>/…) 또는 파일 키`)
}

export function readToken(env = process.env, dir = CONFIG_DIR) {
  if (env.FIGMA_TOKEN?.trim()) return env.FIGMA_TOKEN.trim()
  try {
    return Buffer.from(fs.readFileSync(path.join(dir, 'token'), 'utf8').trim(), 'base64').toString('utf8').trim() || null
  } catch {
    return null
  }
}

const restUrl = () => process.env.FIG_REST_URL || 'https://api.figma.com'

function restStatusError(res) {
  if (res.status === 401 || res.status === 403) return new Error(`토큰이 무효하거나 권한이 없다 (HTTP ${res.status})`)
  if (res.status === 404) return new Error('파일을 찾지 못했다 (HTTP 404)')
  if (res.status === 429) return new Error(`호출 한도에 걸렸다 (HTTP 429, Retry-After ${res.headers.get('retry-after') ?? '없음'}초)`)
  return new Error(`HTTP ${res.status}`)
}

export async function fetchFileMeta(fileKey, token, timeoutMs) {
  const started = Date.now()
  const record = (extra) => recordCall({ backend: 'rest', kind: 'GET', name: 'files/meta', tier: 3, ms: Date.now() - started, ...extra })
  try {
    const res = await fetch(`${restUrl()}/v1/files/${fileKey}/meta`, {
      headers: { 'X-Figma-Token': token },
      signal: AbortSignal.timeout(timeoutMs),
    })
    record({ http: res.status })
    if (res.status === 429) {
      recordCall({ event: 'limit', backend: 'rest', name: 'files/meta', retryAfterSec: Number(res.headers.get('retry-after')) || null })
    }
    if (!res.ok) throw restStatusError(res)
    const { file } = await res.json()
    if (!file?.last_touched_at) throw new Error('응답에 last_touched_at 이 없다')
    return { lastTouchedAt: file.last_touched_at, name: file.name ?? null }
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      record({ http: null, error: 'timeout' })
      throw new Error(`${timeoutMs / 1000}초 안에 응답이 오지 않았다`)
    }
    if (err instanceof TypeError) {
      record({ http: null, error: 'connect' })
      throw new Error(`연결하지 못했다 (${err?.cause?.code || err.name})`)
    }
    throw err
  }
}

export function writeIndex(xml, nodes, dir = CACHE_DIR, now = Date.now(), file = null) {
  const last = nodes.at(-1)
  if (!last) throw new Error('문서에 노드가 없어 색인을 만들 수 없다')
  const { id, type, name, x, y, width, height, hidden } = last
  const meta = {
    builtAt: now,
    count: nodes.length,
    canvases: nodes.filter((n) => n.type === 'canvas' && !n.hidden).map((n) => n.name.trim()),
    probe: { id, type, name, x, y, width, height, hidden },
    ...(file && { file }),
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, INDEX_XML), zlib.gzipSync(xml))
  fs.writeFileSync(path.join(dir, INDEX_META), JSON.stringify(meta))
  return meta
}

export function readIndex(dir = CACHE_DIR) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, INDEX_META), 'utf8'))
    const xml = zlib.gunzipSync(fs.readFileSync(path.join(dir, INDEX_XML))).toString('utf8')
    return { meta, nodes: parseMetadata(xml) }
  } catch {
    throw new Error('색인이 없다 — fig index 로 먼저 만든다.')
  }
}

async function indexMatchesActiveFile(meta, opts) {
  try {
    const [live] = parseMetadata(textOf(await callTool('get_metadata', { nodeId: meta.probe.id }, opts)))
    return Boolean(live) && sameNode(live, meta.probe)
  } catch (err) {
    if (/invalid/i.test(err.message)) return false
    throw err
  }
}

export const INDEX_TRUST_MS = 5 * 60 * 1000

export const isFreshIndex = (builtAt, now = Date.now()) => now >= builtAt && now - builtAt < INDEX_TRUST_MS

async function fileStamp(key, opts) {
  const token = readToken()
  if (!token) throw new Error('파일 키를 받았지만 토큰이 없다 — FIGMA_TOKEN 또는 ~/.config/fig/token 에 Figma 개인 액세스 토큰을 둔다')
  guard('rest', opts)
  const { lastTouchedAt } = await fetchFileMeta(key, token, opts.timeoutMs)
  return { key, lastTouchedAt }
}

async function restFreshness(meta, opts) {
  if (!meta.file) return null
  const token = readToken()
  if (!token) {
    process.stderr.write('fig: 토큰이 없어 파일 변경 확인을 건너뛴다 (FIGMA_TOKEN 또는 ~/.config/fig/token)\n')
    return null
  }
  try {
    guard('rest', opts)
    const live = await fetchFileMeta(meta.file.key, token, opts.timeoutMs)
    return live.lastTouchedAt === meta.file.lastTouchedAt ? 'same' : 'changed'
  } catch (err) {
    process.stderr.write(`fig: 파일 변경 확인에 실패해 5분 규칙으로 답한다 — ${err.message}\n`)
    return null
  }
}

async function indexedNodes(nodeId, opts) {
  if (nodeId !== '0:0') throw new Error('--index 는 문서 전체(대상 생략)에만 쓴다 — 하위 트리는 --index 없이 조회한다.')
  const { meta, nodes } = readIndex()
  const age = agoText(Date.now() - meta.builtAt)
  const rest = await restFreshness(meta, opts)
  if (rest === 'changed') {
    throw new Error(`Figma 파일이 색인을 만든 뒤 바뀌었다 (${age} 만듦, 마지막 편집 기록이 다르다) — fig index 로 다시 만든다.`)
  }
  const fresh = isFreshIndex(meta.builtAt)
  if (rest !== 'same' && !fresh && !(await indexMatchesActiveFile(meta, opts))) {
    throw new Error(`활성 파일이 색인과 다르거나 색인이 오래됐다 (색인: ${meta.canvases[0] ?? '(캔버스 없음)'} 외, ${age} 만듦) — fig index 로 다시 만든다.`)
  }
  const note = rest === 'same' ? ' (파일 변경 없음 확인)' : fresh ? ' (서버 확인 생략)' : ''
  process.stderr.write(`fig: 색인 기준 — ${age} 만듦, ${meta.count}노드${note}\n`)
  return nodes
}

// ── 출력 ─────────────────────────────────────────────────────────────────────

function emit(text, out) {
  const body = text.endsWith('\n') ? text : `${text}\n`
  if (currentCommand !== 'usage') {
    recordCall({ event: 'output', to: out ? 'file' : 'stdout', bytes: Buffer.byteLength(body), lines: body.split('\n').length - 1 })
  }
  if (out) {
    fs.writeFileSync(out, body)
    process.stderr.write(`${out} (${Buffer.byteLength(text)} 바이트)\n`)
  } else {
    process.stdout.write(body)
  }
}

const HELP = `fig — Figma Dev Mode MCP 를 셸에서 쓰는 CLI

사용법: fig <명령> [대상] [옵션]

찾기 — 문서 전체에서 노드를 찾는다
  find  <패턴> [대상]   노드 이름을 정규식으로 검색, 조상 경로까지 출력 (기본 50건까지)
  tree  [대상]          메타데이터를 요약 트리로 (대상 기본값 0:0 = 문서 루트)
  index  [URL|파일키]   문서 전체를 받아 로컬에 저장한다. find·tree 에 --index 를 주면
                        서버에서 문서 전체를 다시 받지 않고 저장본으로 답한다.
                        파일 URL·키와 Figma 토큰(FIGMA_TOKEN 또는 ~/.config/fig/token)이 있으면
                        파일의 마지막 편집 기록(REST meta)을 같이 저장해, 조회 때 MCP 를 부르지
                        않고 파일이 바뀌었는지 확인한다

보기 — 노드 하나를 자세히 본다
  meta  [대상]          노드 트리 메타데이터 XML. get_metadata
  ctx   [대상]          디자인 컨텍스트(참조 코드·토큰). get_design_context
                        코드 없이 Code Connect 안내만 오면 오류로 알리고 재호출 명령을 낸다
  vars  [대상]          변수 정의. get_variable_defs
  shot  [대상]          PNG 스크린샷. get_screenshot

호출 기록
  usage                 이 CLI 가 보낸 요청의 집계(1분·1시간·24시간), 같은 도구·노드의 반복 호출, 마지막 상한 통지, 예산 설정

저수준
  tools                 서버가 제공하는 도구 목록과 인자
  call  <도구> [JSON]   도구를 이름으로 직접 호출 (위에 없는 도구용)

대상
  Figma URL 을 그대로 붙여넣거나(?node-id=7327-61763), 7327-61763,
  7327:61763 을 준다. 생략하면 Figma 에서 지금 선택한 노드를 쓴다.

찾기 옵션
  --type T         이 타입의 노드만 (frame · text · symbol · instance …)
  --prop 이름=값   이름에 든 변형 속성이 일치하는 노드만 (예: Orientation=Portrait)
  --square N|A-B   너비와 높이가 같고 그 크기가 N 또는 A~B 인 노드만 (아이콘 찾기)
  --limit N        stdout 출력 상한, 기본 50, 0 은 제한 없음 (-o 로 파일에 쓰면 전부)
  --index          fig index 로 저장한 문서로 답한다 (대상 생략 시에만)
  --hidden         숨김 노드도 포함 (기본은 제외)
  -d, --depth N    tree 깊이, 기본 2

공통 옵션
  -o, --out FILE   stdout 대신 파일로 쓴다 (shot 은 생략 시 fig-<id>.png)
  --json           구조화 출력 (tree·find·meta)
  --raw            서버 응답(JSON-RPC result)을 그대로 낸다 (서버가 붙인 안내 문구도 포함)
  --timeout SEC    응답 대기 상한, 기본 15초
  --no-cache       캐시된 세션을 쓰지 않고 새로 initialize 한다
  --force          예산·상한 기록 때문에 막힌 호출을 경고하고 그대로 보낸다
  -h, --help       이 도움말

예시
  fig tree                                        # 캔버스 목록
  fig find 'modalHeader'                          # 이름으로 노드 찾기
  fig index && fig find . --square 8-48 --type instance --index   # 아이콘 인스턴스
  fig find . --prop Orientation=Portrait --index  # 변형 속성으로 찾기
  fig meta 'https://figma.com/design/…?node-id=7327-61763'
  fig ctx 7327-61763 -o header.tsx                # 65KB 를 파일로 받아 grep
  fig shot 7327-61763 -o header.png
  fig call get_figjam '{"nodeId":"1:2"}'

환경변수
  FIG_MCP_URL           MCP 엔드포인트, 기본 http://127.0.0.1:3845/mcp
  FIG_BUDGET_MCP_DAY    MCP 읽기 호출(tools/call)의 최근 24시간 예산. 닿으면 --force 없이는 보내지 않는다
  FIG_BUDGET_REST_MIN   REST 호출의 최근 1분 예산. 같은 방식
  호출 원장: $XDG_STATE_HOME/fig/calls-<날짜>.jsonl (기본 ~/.local/state)
`

// ── main ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = {
    json: false, raw: false, force: false, hidden: false, noCache: false, index: false, depth: 2, out: null, help: false,
    timeoutMs: DEFAULT_TIMEOUT_MS, limit: DEFAULT_FIND_LIMIT, type: null, prop: null, square: null,
  }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') opts.help = true
    else if (a === '--json') opts.json = true
    else if (a === '--raw') opts.raw = true
    else if (a === '--hidden') opts.hidden = true
    else if (a === '--force') opts.force = true
    else if (a === '--no-cache') opts.noCache = true
    else if (a === '-o' || a === '--out') opts.out = argv[++i]
    else if (a === '-d' || a === '--depth') opts.depth = Number(argv[++i])
    else if (a === '--timeout') opts.timeoutMs = Number(argv[++i]) * 1000
    else if (a === '--index') opts.index = true
    else if (a === '--limit') opts.limit = Number(argv[++i])
    else if (a === '--type') opts.type = argv[++i]
    else if (a === '--prop') opts.prop = argv[++i]
    else if (a === '--square') opts.square = parseSquare(argv[++i])
    else if (a.startsWith('-') && a !== '-') throw new Error(`모르는 옵션: ${a} (fig --help)`)
    else positional.push(a)
  }
  if (opts.depth != null && Number.isNaN(opts.depth)) throw new Error('--depth 에는 숫자를 준다')
  if (!(opts.timeoutMs > 0)) throw new Error('--timeout 에는 0 보다 큰 초 단위 숫자를 준다')
  if (!Number.isInteger(opts.limit) || opts.limit < 0) throw new Error('--limit 에는 0 이상의 정수를 준다 (0 은 제한 없음)')
  if (opts.type === undefined || opts.type === '') throw new Error('--type 에는 노드 타입을 준다 (예: frame · text · instance)')
  if (opts.prop === undefined || (opts.prop !== null && !/^[^=]+=.+$/.test(opts.prop))) throw new Error('--prop 에는 이름=값 을 준다 (예: Orientation=Portrait)')
  return { opts, positional }
}

async function metadataNodes(target, opts) {
  const nodeId = parseNodeId(target) || '0:0'
  if (opts.index) return indexedNodes(nodeId, opts)
  const result = await callTool('get_metadata', { nodeId }, opts)
  return parseMetadata(textOf(result))
}

export async function main(argv) {
  const { opts, positional } = parseArgs(argv)
  const [cmd, ...rest] = positional
  currentCommand = cmd ?? null
  // --help 는 성공, 인자 없이 부른 것은 실패다.
  if (opts.help || !cmd) { process.stdout.write(HELP); return opts.help ? 0 : 1 }

  const nodeArgs = (target) => {
    const nodeId = parseNodeId(target)
    return nodeId ? { nodeId } : {}
  }

  switch (cmd) {
    case 'ctx': {
      // 스크린샷 블록은 텍스트 파이프에 쓸모가 없다 — 그림이 필요하면 fig shot.
      const args = { ...nodeArgs(rest[0]), clientLanguages: 'unknown', clientFrameworks: 'unknown', excludeScreenshot: true }
      const r = await callTool('get_design_context', args, opts)
      emit(presentText(r, opts, args), opts.out)
      return 0
    }
    case 'meta': {
      const r = await callTool('get_metadata', nodeArgs(rest[0]), opts)
      const text = opts.json && !opts.raw ? JSON.stringify(parseMetadata(textOf(r)), null, 2) : presentText(r, opts)
      emit(text, opts.out)
      return 0
    }
    case 'vars': {
      const r = await callTool('get_variable_defs', nodeArgs(rest[0]), opts)
      emit(presentText(r, opts), opts.out)
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
      const { shown, more } = opts.out ? { shown: hits, more: 0 } : limitHits(hits, opts.limit)
      emit(opts.json ? JSON.stringify(shown, null, 2) : renderFind(shown), opts.out)
      if (more) process.stderr.write(`fig: ${more}건 더 있다 (--limit 0 으로 전부, -o 로 파일에 저장)\n`)
      return 0
    }
    case 'index': {
      const started = Date.now()
      const file = rest[0] ? await fileStamp(parseFileKey(rest[0]), opts) : null
      const xml = splitServerNotes(await callTool('get_metadata', { nodeId: '0:0' }, opts)).text
      const meta = writeIndex(xml, parseMetadata(xml), CACHE_DIR, Date.now(), file)
      process.stderr.write(`fig: 색인을 만들었다 — ${meta.count}노드, 캔버스 ${meta.canvases.length}개, ${((Date.now() - started) / 1000).toFixed(1)}초${file ? `, 파일 ${file.key} 의 마지막 편집 기록 저장` : ''} (${CACHE_DIR})\n`)
      return 0
    }
    case 'usage': {
      const now = Date.now()
      emit(renderUsage(readCalls(now - DAY_MS, stateDir(), now), now), opts.out)
      return 0
    }
    case 'tools': {
      const r = await rpc('tools/list', {}, opts)
      if (opts.raw) { emit(JSON.stringify(r, null, 2), opts.out); return 0 }
      if (!Array.isArray(r?.tools)) throw new Error('서버가 도구 목록(tools)을 주지 않았다 — --raw 로 원문을 확인한다.')
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
      emit(presentText(r, opts), opts.out)
      return 0
    }
    default:
      throw new Error(`모르는 명령: ${cmd} (fig --help)`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch((err) => { process.stderr.write(`fig: ${err?.message || err}\n`); process.exitCode = 1 })
}
