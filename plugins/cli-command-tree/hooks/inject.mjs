#!/usr/bin/env node
// SessionStart 훅 — CLI 명령 이름 트리를 세션 컨텍스트에 넣는다.
//
// 절대 규칙: 세션 시작을 막지 않는다. 무슨 일이 생겨도 exit 0 이고,
// 확신이 없으면 아무것도 내지 않는다(훅 timeout 은 5초).

import { getSpec } from '../scripts/clispec.mjs'

// 훅 timeout(5s)보다 넉넉히 앞서 손을 뗀다. 캐시 히트면 수 ms, 미스면 스폰 ~25회다.
const DEADLINE_MS = Number(process.env.CLAUDE_CLI_SPEC_DEADLINE_MS || 3500)

const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms).unref())

try {
  const spec = await Promise.race([getSpec().catch(() => null), timeout(DEADLINE_MS)])
  if (spec?.text) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: spec.text,
      },
    }))
  }
} catch { /* 조용히 통과 */ }

process.exit(0)
