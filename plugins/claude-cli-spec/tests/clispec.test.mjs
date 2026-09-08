// node --test tests/
//
// 두 층이다:
//  1) 고정 도움말(fixtures) 기반 — 설치된 CLI 버전과 무관하게 파서의 함정 4개를 영구히 잠근다.
//  2) 실제 CLI 기반 — 명령 개수를 잠근다. 버전이 오르면 깨지고, 그 깨짐 자체가 정보다.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseUsage, parseCommandNames, classifyCommandsBlock,
  buildTree, renderTree, countCommands, reparseRendered, verify, resolveBin,
} from '../scripts/clispec.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(path.join(here, 'fixtures', `${name}.txt`), 'utf8')

const BASELINE_VERSION = '2.1.263'
const EXPECTED = { top: 18, mcp: 10, plugin: 13, evalSubs: 1, marketplace: 4, total: 54 }

describe('parseUsage — Usage 첫 줄 하나로 유효성과 하위 유무가 끝난다', () => {
  test('하위 있음', () => {
    assert.deepEqual(parseUsage(fixture('plugin')), { cmdPath: ['plugin'], hasSubcommands: true })
  })
  test('별칭은 첫 이름으로 정규화 (update|upgrade → update)', () => {
    assert.deepEqual(parseUsage(fixture('update')), { cmdPath: ['update'], hasSubcommands: false })
  })
  test('하위 없음', () => {
    assert.deepEqual(parseUsage(fixture('doctor')), { cmdPath: ['doctor'], hasSubcommands: false })
    assert.deepEqual(parseUsage(fixture('agents')), { cmdPath: ['agents'], hasSubcommands: false })
  })
  test('인자 표기는 경로가 아니다 — <id>|--all 의 파이프에 속지 않는다', () => {
    assert.deepEqual(parseUsage(fixture('respawn')), { cmdPath: ['respawn'], hasSubcommands: false })
    assert.deepEqual(parseUsage(fixture('rm')), { cmdPath: ['rm'], hasSubcommands: false })
  })

  // 함정 1: 없는 명령의 --help 는 오류가 아니라 "가장 가까운 유효 조상"의 도움말을 낸다.
  test('함정 1 — 없는 최상위 명령은 최상위로 폴백한다', () => {
    const u = parseUsage(fixture('invalid-toplevel'))
    assert.deepEqual(u.cmdPath, [])            // 'nosuchcmd' 가 아니다 → 요청 경로와 불일치 → 무효
    assert.notDeepEqual(u.cmdPath, ['nosuchcmd'])
  })
  test('함정 1 — 없는 하위 명령은 부모로 폴백한다', () => {
    assert.deepEqual(parseUsage(fixture('invalid-under-plugin')).cmdPath, ['plugin'])
    assert.deepEqual(parseUsage(fixture('invalid-under-eval')).cmdPath, ['plugin', 'eval'])
  })
  test('폴백 도움말을 하위 목록으로 읽으면 상위가 통째로 복사된다 — 경로 대조가 그것을 막는다', () => {
    // 이 도움말의 Commands: 는 최상위 목록 그대로다. 파싱은 되지만 경로가 안 맞아 채택되면 안 된다.
    assert.equal(parseCommandNames(fixture('invalid-toplevel')).length, EXPECTED.top)
    assert.notEqual(parseUsage(fixture('invalid-toplevel')).cmdPath.join(' '), 'nosuchcmd')
  })
})

describe('parseCommandNames — 함정 2·3·4', () => {
  // 함정 3 이 제일 컸다: `  agents [options]    Manage…` 는 이름과 [options] 사이가 한 칸이라
  // `^ {2}(\S+)(?:\s{2,}.*)?$` 로는 매치에 실패한다. 최상위 18개가 8개로 반토막 났었다.
  test('함정 3 — 인자 있는 명령을 놓치지 않는다 (최상위 전수)', () => {
    const names = parseCommandNames(fixture('root'))
    assert.equal(names.length, EXPECTED.top, `최상위 ${EXPECTED.top}개여야 한다`)
    for (const n of ['agents', 'attach', 'logs', 'rm', 'respawn', 'import', 'install', 'gateway', 'ultrareview']) {
      assert.ok(names.includes(n), `인자/옵션 있는 '${n}' 이 빠졌다 — 함정 3 재발`)
    }
    assert.deepEqual(names, [
      'agents', 'attach', 'auth', 'auto-mode', 'doctor', 'gateway', 'import', 'install',
      'logs', 'mcp', 'plugin', 'project', 'respawn', 'rm', 'setup-token', 'stop',
      'ultrareview', 'update',
    ])
  })

  // 함정 4: mcp 의 첫 명령(add) 설명에 예시 블록이 끼어 있고, 그 안에 빈 줄과 콜론 줄이 있다.
  // 빈 줄이나 콜론에서 멈추면 10개가 1개로 줄어든다.
  test('함정 4 — 설명 속 예시 블록에서 조기 종료하지 않는다', () => {
    const names = parseCommandNames(fixture('mcp'))
    assert.equal(names.length, EXPECTED.mcp)
    assert.ok(names.includes('serve'), '예시 블록 뒤의 명령이 잘려나갔다 — 함정 4 재발')
    assert.deepEqual(names, [
      'add', 'add-from-claude-desktop', 'add-json', 'get', 'list',
      'login', 'logout', 'remove', 'reset-project-choices', 'serve',
    ])
  })

  // 함정 2: `  Examples:` 가 정확히 2칸 들여쓰기라 이름 자리에 온다.
  test('함정 2 — 소제목은 이름이 아니라 소제목으로 분류된다', () => {
    const { entries, subheadings, unaccounted } = classifyCommandsBlock(fixture('mcp'))
    assert.ok(subheadings.includes('Examples:'), '소제목이 인식되지 않았다')
    assert.ok(!entries.includes('Examples:'), '소제목이 명령 이름으로 새어 들어갔다')
    assert.deepEqual(unaccounted, [], '2칸 자리인데 분류 못 한 줄이 있다')
  })

  test('commander 자동생성 help 는 버린다', () => {
    for (const f of ['mcp', 'plugin', 'auth', 'auto-mode', 'project', 'plugin-marketplace']) {
      const { entries, dropped } = classifyCommandsBlock(fixture(f))
      assert.ok(!entries.includes('help'), `${f}: help 가 남았다`)
      assert.ok(dropped.includes('help'), `${f}: help 를 못 봤다`)
    }
  })

  test('별칭은 첫 이름만 (install|i, uninstall|remove, prune|autoremove, init|new)', () => {
    const names = parseCommandNames(fixture('plugin'))
    assert.equal(names.length, EXPECTED.plugin)
    for (const n of ['install', 'uninstall', 'prune', 'init']) assert.ok(names.includes(n))
    for (const n of ['i', 'remove', 'autoremove', 'new']) assert.ok(!names.includes(n), `별칭 '${n}' 이 새어 들어갔다`)
  })

  test('3단계', () => {
    assert.deepEqual(parseCommandNames(fixture('plugin-eval')), ['init'])
    assert.deepEqual(parseCommandNames(fixture('plugin-marketplace')), ['add', 'list', 'remove', 'update'])
    assert.equal(parseCommandNames(fixture('plugin-eval')).length, EXPECTED.evalSubs)
    assert.equal(parseCommandNames(fixture('plugin-marketplace')).length, EXPECTED.marketplace)
  })

  test('Commands: 블록이 없으면 빈 목록', () => {
    assert.deepEqual(parseCommandNames(fixture('doctor')), [])
    assert.deepEqual(parseCommandNames('Usage: claude x\n\nOptions:\n  --a  b\n'), [])
  })

  test('어떤 도움말에도 분류 못 한 2칸 줄은 없다', () => {
    for (const f of ['root', 'mcp', 'plugin', 'auth', 'auto-mode', 'project',
                     'plugin-eval', 'plugin-marketplace', 'doctor', 'agents']) {
      assert.deepEqual(classifyCommandsBlock(fixture(f)).unaccounted, [], `${f} 에 분류불가 줄`)
    }
  })
})

describe('렌더링 왕복', () => {
  test('산출물을 되읽으면 같은 트리가 나온다', () => {
    const tree = fixture('tree-2.1.263').trimEnd()
    const back = reparseRendered(tree)
    assert.equal(back.children.length, EXPECTED.top)
    const plugin = back.children.find((n) => n.name === 'plugin')
    assert.equal(plugin.children.length, EXPECTED.plugin)
    assert.deepEqual(plugin.children.find((n) => n.name === 'marketplace').children.map((n) => n.name),
      ['add', 'list', 'remove', 'update'])
    assert.deepEqual(plugin.children.find((n) => n.name === 'eval').children.map((n) => n.name), ['init'])
    assert.equal(back.children.find((n) => n.name === 'mcp').children.length, EXPECTED.mcp)
    assert.deepEqual(back.children.find((n) => n.name === 'doctor').children, [])
  })

  test('컨텍스트 예산 안에 있다 (< 1KB)', () => {
    assert.ok(Buffer.byteLength(fixture('tree-2.1.263'), 'utf8') < 1024)
  })
})

// --- 실제 CLI ----------------------------------------------------------------
// 개수를 잠근다. 버전이 오르면 여기가 깨지고, 무엇이 늘고 줄었는지가 그대로 드러난다.

describe('실제 CLI', { concurrency: false }, async () => {
  let bin, version
  try { ({ bin, version } = await resolveBin()) } catch { /* 아래에서 skip */ }

  test('claude 실행 파일이 있다', { skip: bin ? false : 'claude 없음' }, () => {
    assert.ok(bin)
  })

  test('트리 · 개수 · 검증', { skip: bin ? false : 'claude 없음' }, async () => {
    const root = await buildTree(bin)
    const tree = renderTree(root)
    const { byDepth, total } = countCommands(root)
    const drift = version === BASELINE_VERSION ? '' :
      ` (기준선 claude ${BASELINE_VERSION} ↔ 설치본 ${version} — 버전 차이라면 fixtures/tree-*.txt 와 EXPECTED 를 갱신하십시오)`

    const { ok, problems } = verify(root, tree)
    assert.ok(ok, `전수 대조 실패:\n${problems.join('\n')}`)

    assert.equal(byDepth[0], EXPECTED.top, `1단계 명령 수${drift}`)
    assert.equal(root.children.find((n) => n.name === 'mcp')?.children.length, EXPECTED.mcp, `mcp 하위 수${drift}`)
    assert.equal(root.children.find((n) => n.name === 'plugin')?.children.length, EXPECTED.plugin, `plugin 직속 하위 수${drift}`)
    assert.equal(total, EXPECTED.total, `전체 명령 수${drift}`)

    const baselinePath = path.join(here, 'fixtures', `tree-${BASELINE_VERSION}.txt`)
    if (existsSync(baselinePath)) {
      assert.equal(tree, readFileSync(baselinePath, 'utf8').trimEnd(), `트리가 기준선과 다르다${drift}`)
    }
  })

  // 이번 실패의 원점: claude plugin update 를 몰라 install 만 반복했다.
  test('놓쳤던 그 명령이 트리에 있다', { skip: bin ? false : 'claude 없음' }, async () => {
    const root = await buildTree(bin)
    const plugin = root.children.find((n) => n.name === 'plugin')
    assert.ok(plugin?.children.some((n) => n.name === 'update'), 'plugin update 가 없다')
  })
})
