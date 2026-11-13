#!/usr/bin/env node
// clispec — Claude Code CLI 의 "명령 이름 트리"를 --help 에서 뽑아낸다.
//
// 왜 이름만인가: 세션이 놓치는 것은 옵션 상세가 아니라 "그 명령이 존재한다"는 사실이다.
// (claude plugin update 를 몰라 install 만 반복하다 "already installed" 로 헛돈 사례)
// 옵션까지 담으면 34KB, 이름만이면 ~0.4KB 다.
//
// claude 는 commander.js 다. 스키마 덤프가 없으므로(claude schema/commands/introspect 는
// 전부 최상위 도움말로 떨어진다) --help 를 읽는 수밖에 없다.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const MAX_DEPTH = 4 // 안전장치. 실제 트리는 3단계까지다.

// --- claude 바이너리 찾기 -----------------------------------------------------
// 훅은 PATH 가 얇은 환경에서 돌 수 있어 후보를 몇 개 둔다.
const BIN_CANDIDATES = [
  process.env.CLAUDE_CLI_SPEC_BIN,
  'claude',
  path.join(os.homedir(), '.local/bin/claude'),
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
].filter(Boolean)

function run(bin, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 << 20, encoding: 'utf8' },
      (err, stdout, stderr) => {
        // commander 는 --help 를 exit 0 으로 내지만, 어떤 경로는 stderr 로 낸다.
        const out = (stdout || '') + (stderr || '')
        if (err && !out) return reject(err)
        resolve(out)
      })
  })
}

export async function resolveBin() {
  for (const bin of BIN_CANDIDATES) {
    try {
      const out = await run(bin, ['--version'], 5000)
      const version = out.trim().split(/\s+/)[0]
      if (/^\d+\.\d+/.test(version)) return { bin, version }
    } catch { /* 다음 후보 */ }
  }
  throw new Error('claude 실행 파일을 찾지 못했습니다')
}

const helpOf = (bin, cmdPath) => run(bin, [...cmdPath, '--help'])

// --- 파싱 --------------------------------------------------------------------

// Usage 첫 줄 하나로 "그 명령이 실재하는가 / 하위가 있는가"가 끝난다.
// commander 가 경로를 그대로 에코하기 때문이다.
//
//   Usage: claude plugin|plugins [options] [command]   유효 · 하위 있음
//   Usage: claude doctor [options]                     유효 · 하위 없음
//   Usage: claude [options] [command] [prompt]         claude nosuchcmd → 최상위로 폴백
//   Usage: claude plugin eval [options] [command] [target]
//                                                      claude plugin eval nosuch → 부모로 폴백
//
// 함정 1: 없는 명령의 --help 는 오류가 아니라 "가장 가까운 유효 조상"의 도움말을 낸다.
// 그것을 하위 목록으로 읽으면 상위 목록이 통째로 복사된다(update: agents attach auth … 같은 헛것).
// 에코된 경로가 요청한 경로와 정확히 같을 때만 유효로 본다.
export function parseUsage(helpText) {
  const first = (helpText.split('\n')[0] || '').trim()
  const m = /^Usage:\s+claude\b(.*)$/.exec(first)
  if (!m) return null
  const cmdPath = []
  let hasSubcommands = false
  for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) {
    if (tok === '[command]') { hasSubcommands = true; continue }
    // 인자 표기는 경로가 아니다: <id>, [target], <id>|--all, [--discard-unpushed <c>@<w>]
    if (tok.startsWith('[') || tok.startsWith('<')) continue
    cmdPath.push(tok.split('|')[0]) // 별칭: plugin|plugins → plugin, update|upgrade → update
  }
  return { cmdPath, hasSubcommands }
}

// Commands: 블록에서 이름 자리에 있는 줄을 고른다.
//
// 함정 2: 소제목이 이름 자리에 온다 — `  Examples:` 가 정확히 2칸 들여쓰기다.
// 함정 3: 인자 있는 명령을 놓친다 — `  agents [options]    Manage background agents` 는
//         이름과 [options] 사이가 "한 칸"이라 `^ {2}(\S+)(?:\s{2,}.*)?$` 로는 매치에 실패한다.
//         최상위 18개가 8개로 반토막 나고, 결과가 그럴듯해 개수를 세기 전엔 안 드러난다.
//         → 이름 뒤 인자 표기는 이름의 일부가 아닌 것으로 다루고 첫 토큰만 취한다.
// 함정 4: 설명 안의 예시 블록에서 조기 종료한다 — `claude mcp --help` 는 첫 명령(add) 설명에
//         예시가 끼어 있고 그 안의 `    # Add HTTP server:` 가 콜론으로 끝난다.
//         빈 줄이나 콜론에서 멈추면 mcp 하위 10개가 1개로 줄어든다.
//         → 블록은 "0칸 들여쓰기(다음 섹션)"에서만 끝나고, 정확히 2칸만 이름 자리다.
const NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*(?:\|[A-Za-z][A-Za-z0-9._-]*)*$/

export function classifyCommandsBlock(helpText) {
  const lines = helpText.split('\n')
  const start = lines.findIndex((l) => l.trimEnd() === 'Commands:')
  if (start === -1) return { entries: [], dropped: [], subheadings: [], unaccounted: [] }

  const entries = []     // 채택한 이름
  const dropped = []     // 일부러 버린 것 (commander 자동생성 help)
  const subheadings = [] // 설명에 끼어든 소제목 — 콜론으로 끝난다 (함정 2의 `  Examples:`)
  const unaccounted = [] // 2칸 자리인데 어느 쪽으로도 해석 못 한 줄 — 검증에서 드러나야 한다

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^\S/.test(line)) break            // 0칸 = 다음 섹션. 블록 끝은 여기뿐이다(함정 4).
    const m = /^ {2}(\S.*)$/.exec(line)    // 3칸 이상은 설명·예시 연속줄이다
    if (!m) continue                       // 빈 줄·'  '(2칸뿐) 포함 — 여기서 멈추지 않는다
    const token = m[1].split(/\s+/)[0]     // 함정 3: 첫 토큰만
    // 함정 2: 소제목이 이름 자리에 온다. commander 의 명령 이름은 콜론으로 끝나지 않으므로
    // 콜론으로 끝나는 토큰은 "알고 버리는" 것이고, 그 외의 해석 실패만 검증에 올린다.
    if (token.endsWith(':')) { subheadings.push(token); continue }
    if (!NAME_RE.test(token)) {
      unaccounted.push({ line: i + 1, text: line })
      continue
    }
    const name = token.split('|')[0]
    if (name === 'help') { dropped.push(name); continue } // commander 자동생성
    entries.push(name)
  }
  return { entries, dropped, subheadings, unaccounted }
}

export const parseCommandNames = (helpText) => classifyCommandsBlock(helpText).entries

// --- 트리 만들기 --------------------------------------------------------------

async function pool(items, limit, fn) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}

export async function buildTree(bin, { concurrency = 8 } = {}) {
  const rootHelp = await helpOf(bin, [])
  const root = { name: null, cmdPath: [], help: rootHelp, children: [] }
  root.children = parseCommandNames(rootHelp).map((name) => ({
    name, cmdPath: [name], help: null, children: [],
  }))

  let frontier = root.children
  for (let depth = 1; depth < MAX_DEPTH && frontier.length; depth++) {
    await pool(frontier, concurrency, async (node) => {
      const help = await helpOf(bin, node.cmdPath)
      const usage = parseUsage(help)
      // 경로 에코가 정확히 일치할 때만 유효(함정 1)
      if (!usage || usage.cmdPath.join(' ') !== node.cmdPath.join(' ')) return
      node.help = help
      if (!usage.hasSubcommands) return
      node.children = parseCommandNames(help).map((name) => ({
        name, cmdPath: [...node.cmdPath, name], help: null, children: [],
      }))
    })
    frontier = frontier.flatMap((n) => n.children)
  }
  return root
}

// --- 렌더링 ------------------------------------------------------------------
// 2단계는 `부모: 자식 자식`, 3단계는 괄호로 계층을 살린다.
//   plugin: details … eval(init) … marketplace(add list remove update) … validate

const renderNested = (node) =>
  node.children.length ? `${node.name}(${node.children.map(renderNested).join(' ')})` : node.name

export function renderTree(root) {
  return root.children
    .map((n) => (n.children.length ? `${n.name}: ${n.children.map(renderNested).join(' ')}` : n.name))
    .join('\n')
}

export function countCommands(root) {
  const byDepth = []
  const walk = (node, depth) => {
    for (const child of node.children) {
      byDepth[depth] = (byDepth[depth] || 0) + 1
      walk(child, depth + 1)
    }
  }
  walk(root, 1)
  return { byDepth: byDepth.slice(1), total: byDepth.reduce((a, b) => a + (b || 0), 0) }
}

// --- 캐시 --------------------------------------------------------------------
// claude --version 이 키다. 버전이 바뀔 때만 실제 파싱이 돌고, 평소엔 파일 읽기 한 번이다.
// 그래서 낡지 않는다 — CLI 가 갱신되면 자동으로 다시 뜬다.

export function cacheDir() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  return path.join(base, 'claude-cli-spec')
}

const cacheFile = (version) => path.join(cacheDir(), `${version.replace(/[^\w.-]/g, '_')}.txt`)

export async function readCache(version) {
  try {
    const text = await fs.readFile(cacheFile(version), 'utf8')
    return text.trim() ? text : null
  } catch { return null }
}

export async function writeCache(version, text) {
  const dir = cacheDir()
  await fs.mkdir(dir, { recursive: true })
  const file = cacheFile(version)
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, file) // 원자적 교체 — 동시 세션이 반쪽 파일을 읽지 않게
  // 지난 버전 파일은 치운다
  for (const entry of await fs.readdir(dir)) {
    if (entry.endsWith('.txt') && path.join(dir, entry) !== file) {
      await fs.rm(path.join(dir, entry), { force: true }).catch(() => {})
    }
  }
}

// --- 컨텍스트에 넣을 텍스트 ---------------------------------------------------

export function renderContext(version, tree) {
  return [
    `Claude Code CLI ${version} — 명령 이름 트리(전수):`,
    '',
    tree,
    '',
    '상세는 `claude <경로> --help`.',
  ].join('\n')
}

export async function getSpec({ noCache = false } = {}) {
  const { bin, version } = await resolveBin()
  if (!noCache) {
    const cached = await readCache(version)
    if (cached) return { version, text: cached, cached: true }
  }
  const root = await buildTree(bin)
  const text = renderContext(version, renderTree(root))
  await writeCache(version, text).catch(() => {}) // 캐시 실패가 산출을 막지는 않는다
  return { version, text, cached: false, root }
}

// --- 검증 --------------------------------------------------------------------
// 함정 3 은 결과가 멀쩡해 보여서 개수를 세기 전엔 안 보인다. 그래서 전수 대조가 필수다.
//
// 1) 도움말 Commands: 블록의 "2칸 자리" 줄을 하나도 빠짐없이 분류했는가 (unaccounted)
// 2) 도움말에서 뽑은 이름 집합 == 산출물을 되읽은 이름 집합 (깊이별 빠짐/잉여)

export function reparseRendered(tree) {
  const root = { name: null, children: [] }
  for (const line of tree.split('\n')) {
    if (!line.trim()) continue
    const [head, rest] = line.includes(': ') ? [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2)] : [line, '']
    const node = { name: head, children: [] }
    if (rest) {
      // `a b(c d) e` → 괄호 인식 분할
      let depth = 0, buf = ''
      const chunks = []
      for (const ch of rest) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (ch === ' ' && depth === 0) { if (buf) chunks.push(buf); buf = ''; continue }
        buf += ch
      }
      if (buf) chunks.push(buf)
      node.children = chunks.map((c) => {
        const m = /^([^(]+)\((.*)\)$/.exec(c)
        return m
          ? { name: m[1], children: m[2].split(' ').filter(Boolean).map((n) => ({ name: n, children: [] })) }
          : { name: c, children: [] }
      })
    }
    root.children.push(node)
  }
  return root
}

const namesByDepth = (root) => {
  const out = []
  const walk = (node, depth, prefix) => {
    for (const child of node.children) {
      ;(out[depth] ||= []).push([...prefix, child.name].join(' '))
      walk(child, depth + 1, [...prefix, child.name])
    }
  }
  walk(root, 0, [])
  return out
}

export function verify(root, tree) {
  const problems = []

  // 1) 분류 못 한 줄
  const walk = (node) => {
    if (node.help) {
      const { unaccounted } = classifyCommandsBlock(node.help)
      for (const u of unaccounted) {
        problems.push(`분류불가 [claude ${node.cmdPath.join(' ')} --help:${u.line}] ${JSON.stringify(u.text)}`)
      }
    }
    node.children.forEach(walk)
  }
  walk(root)

  // 2) 깊이별 전수 대조 (도움말 ↔ 산출물)
  const fromHelp = namesByDepth(root)
  const fromRender = namesByDepth(reparseRendered(tree))
  const depths = Math.max(fromHelp.length, fromRender.length)
  const perDepth = []
  for (let d = 0; d < depths; d++) {
    const a = new Set(fromHelp[d] || [])
    const b = new Set(fromRender[d] || [])
    const missing = [...a].filter((x) => !b.has(x))
    const extra = [...b].filter((x) => !a.has(x))
    perDepth.push({ depth: d + 1, help: a.size, rendered: b.size, missing, extra })
    for (const m of missing) problems.push(`빠짐 (${d + 1}단계): ${m}`)
    for (const e of extra) problems.push(`잉여 (${d + 1}단계): ${e}`)
  }
  return { ok: problems.length === 0, problems, perDepth }
}

// --- CLI ---------------------------------------------------------------------

async function main(argv) {
  const flags = new Set(argv)
  if (flags.has('--help') || flags.has('-h')) {
    process.stdout.write([
      'clispec — Claude Code CLI 명령 이름 트리',
      '',
      '  clispec              캐시 우선으로 컨텍스트 텍스트 출력',
      '  clispec --no-cache   캐시를 무시하고 새로 파싱',
      '  clispec --tree       트리만 (머리말/꼬리말 없이)',
      '  clispec --verify     전수 대조 검증 (빠짐·잉여·분류불가). 문제 있으면 exit 1',
      '  clispec --cache-path 캐시 파일 위치',
      '',
    ].join('\n'))
    return 0
  }

  if (flags.has('--cache-path')) {
    const { version } = await resolveBin()
    process.stdout.write(`${cacheFile(version)}\n`)
    return 0
  }

  if (flags.has('--verify')) {
    const { bin, version } = await resolveBin()
    const root = await buildTree(bin)
    const tree = renderTree(root)
    const { ok, problems, perDepth } = verify(root, tree)
    const { byDepth, total } = countCommands(root)
    process.stdout.write(`${tree}\n\n`)
    process.stdout.write(`claude ${version}\n`)
    process.stdout.write(`명령 ${total}개 (${byDepth.map((n, i) => `${i + 1}단계 ${n}`).join(' · ')})\n`)
    process.stdout.write(`${Buffer.byteLength(tree, 'utf8')} 바이트 · ${tree.split('\n').length} 줄\n`)
    for (const d of perDepth) {
      process.stdout.write(`  ${d.depth}단계: 도움말 ${d.help} ↔ 산출물 ${d.rendered}` +
        ` · 빠짐 ${d.missing.length} · 잉여 ${d.extra.length}\n`)
    }
    if (ok) { process.stdout.write('검증 통과\n'); return 0 }
    process.stdout.write('\n검증 실패:\n')
    for (const p of problems) process.stdout.write(`  ${p}\n`)
    return 1
  }

  const { version, text, cached } = await getSpec({ noCache: flags.has('--no-cache') })
  if (flags.has('--tree')) {
    const { bin } = await resolveBin()
    process.stdout.write(`${renderTree(await buildTree(bin))}\n`)
    return 0
  }
  process.stdout.write(`${text}\n`)
  if (flags.has('--debug')) process.stderr.write(`[clispec] ${version} cached=${cached}\n`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`clispec: ${err?.message || err}\n`)
    process.exit(1)
  })
}
