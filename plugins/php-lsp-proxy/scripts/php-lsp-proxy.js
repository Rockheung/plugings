#!/usr/bin/env node
/**
 * php-lsp-proxy — PHP LSP(intelephense) 멀티플렉싱 stdio 프록시.
 *
 * 핵심: **LSP 요청의 파일 경로가 곧 워크스페이스 선택이다.**
 *  - textDocument/* 요청의 uri 가 속한 git toplevel(마커 존재 시)별로 intelephense 인스턴스를
 *    lazy spawn 하고 그 인스턴스로 라우팅한다. 도구 호출에서 워크트리 파일을 넘기면 그 트리가
 *    자동으로 인덱싱·응답한다 — 설정 수정/서버 kill/reload 불필요.
 *  - workspace/symbol 처럼 uri 가 없는 요청은 살아있는 전 인스턴스에 fan-out 후 결과 병합.
 *  - 기본(default) 인스턴스의 워크스페이스 우선순위:
 *    argv(--workspace <p> | --workspace=<p> | positional) > env PHP_LSP_WORKSPACE
 *    > cwd git toplevel(autoDetect, 마커 존재 시) > config defaultWorkspace.
 *
 * 존재 이유 (하네스 실측 제약 2026-07-08):
 *  - LSP 설정 변수 치환 미동작 → 실경로 하드코딩 강제.
 *  - 하네스는 initialize rootUri 로 세션 cwd 를 보냄 → 워크스페이스 제어 지점이 여기뿐.
 *  - JSON-RPC 로깅(~/.config/php-lsp-proxy/logs/)으로 인덱싱/표시 문제를 실측 진단.
 *
 * 설정: ~/.config/php-lsp-proxy/config.json
 *  { "defaultWorkspace": "/abs/path", "autoDetect": true,
 *    "markers": ["composer.json", "index.php", "html"],
 *    "server": "intelephense", "serverArgs": ["--stdio"],
 *    "maxServers": 3, "log": "meta" }
 */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'php-lsp-proxy');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LOG_DIR = path.join(CONFIG_DIR, 'logs');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { return {}; }
}
const cfg = Object.assign({
  server: 'intelephense',
  serverArgs: ['--stdio'],
  autoDetect: true,
  markers: ['composer.json', 'index.php', 'html'],
  defaultWorkspace: '',
  maxServers: 3,
  log: 'meta', // off | meta | full
}, loadConfig());

// ---- 로깅 ----
let logStream = null;
if (cfg.log !== 'off') {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    logStream = fs.createWriteStream(path.join(LOG_DIR, `proxy-${ts}-${process.pid}.log`), { flags: 'a' });
  } catch (e) { /* 로깅 실패는 치명 아님 */ }
}
function log(line) {
  if (logStream) logStream.write(`${new Date().toISOString()} ${line}\n`);
}

// ---- workspace 판별 ----
function hasMarkers(dir) {
  return cfg.markers.some((m) => fs.existsSync(path.join(dir, m)));
}
function gitToplevel(fromDir) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: fromDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch (e) { return null; }
}
function workspaceFromArgv() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace' && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith('--workspace=')) return argv[i].slice('--workspace='.length);
    if (!argv[i].startsWith('-')) return argv[i];
  }
  return null;
}
function detectDefaultWorkspace() {
  const fromArgv = workspaceFromArgv();
  if (fromArgv) { log(`default workspace: argv = ${fromArgv}`); return fromArgv; }
  if (process.env.PHP_LSP_WORKSPACE) {
    log(`default workspace: env = ${process.env.PHP_LSP_WORKSPACE}`);
    return process.env.PHP_LSP_WORKSPACE;
  }
  if (cfg.autoDetect) {
    const top = gitToplevel(process.cwd());
    if (top && hasMarkers(top)) { log(`default workspace: autoDetect = ${top}`); return top; }
    if (top) log(`default workspace: git toplevel(${top}) 마커 불일치 — 건너뜀`);
  }
  if (cfg.defaultWorkspace) { log(`default workspace: config = ${cfg.defaultWorkspace}`); return cfg.defaultWorkspace; }
  log('default workspace: 결정 실패 — 세션 cwd 사용');
  return process.cwd();
}
const DEFAULT_WS = detectDefaultWorkspace();

function uriToPath(uri) {
  if (!uri || !uri.startsWith('file://')) return null;
  return decodeURIComponent(uri.slice('file://'.length));
}
// 요청 uri → 담당 워크스페이스. git toplevel + 마커 매치 시 그 트리, 아니면 default.
const wsCache = new Map(); // dirname -> ws
function workspaceForUri(uri) {
  const p = uriToPath(uri);
  if (!p) return DEFAULT_WS;
  if (p.startsWith(DEFAULT_WS + path.sep)) return DEFAULT_WS;
  const dir = path.dirname(p);
  if (wsCache.has(dir)) return wsCache.get(dir);
  const top = gitToplevel(dir);
  const ws = (top && hasMarkers(top)) ? top : DEFAULT_WS;
  wsCache.set(dir, ws);
  return ws;
}

// ---- JSON-RPC 프레이밍 ----
function makeFrameParser(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = buf.slice(0, headerEnd).toString('ascii');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { buf = buf.slice(headerEnd + 4); continue; }
      const len = parseInt(m[1], 10);
      const start = headerEnd + 4;
      if (buf.length < start + len) return;
      const body = buf.slice(start, start + len);
      buf = buf.slice(start + len);
      onMessage(body);
    }
  };
}
function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}
function toClient(obj) { process.stdout.write(frame(obj)); }

// ---- 클라이언트 세션 상태 (child 재생용) ----
let clientInitParams = null;   // 원본 initialize params
let clientInitId = null;
let clientInitialized = false; // initialized 노티 수신 여부
let lastConfigNotification = null; // 최신 didChangeConfiguration

// ---- child 관리 ----
let nextChildIdx = 0;
const children = new Map(); // ws -> child
// child = { idx, ws, proc, ready, pendingSends: Buffer[], lastUsed }

const FANOUT_METHODS = new Set(['workspace/symbol']);
const pendingFanouts = new Map(); // origId(str) -> {want, got, items, timer}

function describe(msg, dir, idx) {
  const kind = msg.method ? `method=${msg.method}` : (msg.id !== undefined ? `response id=${msg.id}` : '?');
  return `${dir}#${idx} ${kind}${msg.id !== undefined && msg.method ? ` id=${msg.id}` : ''}`;
}
function logServerMsg(child, body) {
  if (cfg.log === 'full') log(`S→C#${child.idx} ${body}`);
  else if (cfg.log === 'meta') {
    try {
      const msg = JSON.parse(body.toString('utf8'));
      if (msg.method === 'window/logMessage' || msg.method === '$/progress') {
        log(`S→C#${child.idx} ${msg.method} ${JSON.stringify(msg.params).slice(0, 300)}`);
      } else log(describe(msg, 'S→C', child.idx));
    } catch (e) { log(`S→C#${child.idx} (파싱 불가)`); }
  }
}

function ensureChild(ws) {
  let child = children.get(ws);
  if (child) { child.lastUsed = Date.now(); return child; }
  // maxServers 초과 시 가장 오래 안 쓴 비-default child 정리
  if (children.size >= cfg.maxServers) {
    let victim = null;
    for (const c of children.values()) {
      if (c.ws === DEFAULT_WS) continue;
      if (!victim || c.lastUsed < victim.lastUsed) victim = c;
    }
    if (victim) {
      log(`child#${victim.idx} LRU 종료 (ws=${victim.ws})`);
      children.delete(victim.ws);
      try { victim.proc.kill(); } catch (e) {}
    }
  }
  child = {
    idx: nextChildIdx++, ws, ready: false, indexed: false, settled: false,
    pendingSends: [], pendingIndexed: [], lastUsed: Date.now(),
    opened: new Set(),
    proc: spawn(cfg.server, cfg.serverArgs, { stdio: ['pipe', 'pipe', 'pipe'] }),
  };
  // 인덱싱 미완 상태가 지속되면(indexingEnded 미수신) 게이트를 강제 해제 — 교착 방지
  setTimeout(() => { if (!child.indexed) { log(`child#${child.idx} 인덱싱 게이트 타임아웃 해제`); markIndexed(child); } }, 90000);
  children.set(ws, child);
  log(`child#${child.idx} spawn ws=${ws}`);
  child.proc.on('error', (e) => { log(`child#${child.idx} spawn 실패: ${e.message}`); children.delete(ws); });
  child.proc.stdin.on('error', (e) => log(`child#${child.idx} stdin error(무시): ${e.code || e.message}`));
  child.proc.on('exit', (code, sig) => {
    log(`child#${child.idx} exit code=${code} sig=${sig}`);
    if (children.get(ws) === child) children.delete(ws);
  });
  child.proc.stderr.on('data', (d) => log(`child#${child.idx} stderr: ${String(d).trim()}`));

  const parser = makeFrameParser((body) => onServerMessage(child, body));
  child.proc.stdout.on('data', parser);

  // initialize 핸드셰이크 (클라이언트 원본 params 를 이 ws 로 재작성)
  const uri = 'file://' + ws;
  const params = Object.assign({}, clientInitParams, {
    rootUri: uri, rootPath: ws, workspaceFolders: [{ uri, name: path.basename(ws) }],
  });
  child.proc.stdin.write(frame({ jsonrpc: '2.0', id: `init:${child.idx}`, method: 'initialize', params }));
  log(`child#${child.idx} initialize → ${uri}`);
  return child;
}

// 인덱싱 완료 전에 문서를 열거나 질의하면 그 문서의 참조 해석이 빈 결과로 굳는다(실측 레이스).
// → 워크스페이스 인덱싱이 끝날 때까지 textDocument/* 전체와 workspace/symbol 을 FIFO 로 보류.
function isIndexGated(obj) {
  if (!obj.method) return false;
  return obj.method.startsWith('textDocument/') || obj.method === 'workspace/symbol';
}
// 게이트 통과 조건: 노티(didOpen 등)는 인덱싱 완료 시, 요청은 완료 + settle 유예(1.2s) 후.
// (캐시 로드 직후엔 didOpen+즉시 질의가 빈 결과로 굳는 것 실측 — B1 대조: +1.2s 후 질의는 정상)
const SETTLE_MS = 1200;
function gatePassed(child, obj) {
  return obj.id === undefined ? child.indexed : child.settled;
}
function childSend(child, obj) {
  try {
    if (!child.ready) { child.pendingSends.push(obj); return; }
    if (isIndexGated(obj) && !gatePassed(child, obj)) {
      child.pendingIndexed.push(obj);
      log(`child#${child.idx} 인덱싱 대기 큐잉: ${obj.method}${obj.id !== undefined ? ` id=${obj.id}` : ''}`);
      return;
    }
    child.proc.stdin.write(frame(obj));
  } catch (e) { log(`child#${child.idx} write 실패(무시): ${e.code || e.message}`); }
}
function drainGated(child) {
  const q = child.pendingIndexed; child.pendingIndexed = [];
  for (const obj of q) childSend(child, obj); // 재평가 — 통과 못 한 것은 다시 큐로
}
function markIndexed(child) {
  if (child.indexed) return;
  child.indexed = true;
  log(`child#${child.idx} 인덱싱 완료 — 노티 방출, 요청은 settle ${SETTLE_MS}ms 후`);
  drainGated(child);
  setTimeout(() => { child.settled = true; drainGated(child); log(`child#${child.idx} settle — 보류 요청 방출`); }, SETTLE_MS);
}

function onServerMessage(child, body) {
  logServerMsg(child, body);
  let msg;
  try { msg = JSON.parse(body.toString('utf8')); } catch (e) { return; }

  // 1) 우리가 보낸 child initialize 의 응답
  if (msg.id === `init:${child.idx}`) {
    child.ready = true;
    child.proc.stdin.write(frame({ jsonrpc: '2.0', method: 'initialized', params: {} }));
    if (lastConfigNotification) child.proc.stdin.write(frame(lastConfigNotification));
    const q = child.pendingSends; child.pendingSends = [];
    for (const obj of q) childSend(child, obj); // 재평가 — 인덱스 의존 요청은 게이트로

    // 첫(default) child 의 응답은 클라이언트 initialize 응답으로 전달
    if (clientInitId !== null && !onServerMessage.initForwarded) {
      onServerMessage.initForwarded = true;
      toClient({ jsonrpc: '2.0', id: clientInitId, result: msg.result });
      log(`child#${child.idx} capabilities → 클라이언트 initialize 응답으로 전달`);
    }
    return;
  }

  // 2) fan-out 응답 수집
  if (msg.id !== undefined && msg.method === undefined && typeof msg.id === 'string' && msg.id.startsWith('fan:')) {
    const origId = msg.id.slice(msg.id.indexOf(':', 4) + 1);
    const fan = pendingFanouts.get(origId);
    if (fan) {
      fan.got++;
      if (Array.isArray(msg.result)) fan.items.push(...msg.result);
      if (fan.got >= fan.want) {
        clearTimeout(fan.timer);
        pendingFanouts.delete(origId);
        toClient({ jsonrpc: '2.0', id: fan.rawId, result: fan.items });
        log(`fan-out(${origId}) 완료: ${fan.items.length}건 병합`);
      }
    }
    return;
  }

  // 2.5) 인덱싱 완료 감지 → 보류 중인 인덱스 의존 요청 방출
  if (msg.method === 'indexingEnded' ||
      (msg.method === 'window/logMessage' && msg.params && /Indexing finished/.test(msg.params.message || ''))) {
    markIndexed(child);
    // notification 은 아래 4) 로 계속 전달
  }

  // 3) 서버발 요청 — id 를 child 네임스페이스로 재작성해 클라이언트로
  if (msg.method && msg.id !== undefined) {
    const rewritten = Object.assign({}, msg, { id: `srv:${child.idx}:${msg.id}` });
    toClient(rewritten);
    return;
  }

  // 4) 그 외(노티·일반 응답) 그대로 전달
  toClient(msg);
}

// ---- 클라이언트 → 프록시 ----
const parseClient = makeFrameParser((body) => {
  let msg;
  try { msg = JSON.parse(body.toString('utf8')); } catch (e) { return; }
  if (cfg.log === 'full') log(`C→S ${body}`);
  else if (cfg.log === 'meta') log(describe(msg, 'C→S', '*'));

  // 서버발 요청에 대한 클라이언트 응답 → 해당 child 로 복원 라우팅
  if (msg.method === undefined && typeof msg.id === 'string' && msg.id.startsWith('srv:')) {
    const parts = msg.id.split(':'); // srv:<idx>:<origId...>
    const idx = Number(parts[1]);
    const origId = msg.id.slice(`srv:${idx}:`.length);
    for (const c of children.values()) {
      if (c.idx === idx) {
        const restored = Object.assign({}, msg, { id: isNaN(Number(origId)) ? origId : Number(origId) });
        c.proc.stdin.write(frame(restored));
        return;
      }
    }
    return;
  }

  switch (msg.method) {
    case 'initialize': {
      clientInitParams = msg.params || {};
      clientInitId = msg.id;
      log(`클라이언트 initialize 수신: rootUri=${clientInitParams.rootUri} → default ws=${DEFAULT_WS}`);
      ensureChild(DEFAULT_WS);
      return;
    }
    case 'initialized': {
      clientInitialized = true;
      return; // child 는 ready 시점에 자체 initialized 를 이미 보냄
    }
    case 'workspace/didChangeConfiguration': {
      lastConfigNotification = msg;
      for (const c of children.values()) childSend(c, msg);
      return;
    }
    case 'shutdown': {
      for (const c of children.values()) childSend(c, { jsonrpc: '2.0', id: `init:${c.idx}-shutdown`, method: 'shutdown' });
      toClient({ jsonrpc: '2.0', id: msg.id, result: null });
      return;
    }
    case 'exit': {
      for (const c of children.values()) { try { c.proc.stdin.write(frame(msg)); } catch (e) {} }
      setTimeout(() => process.exit(0), 300);
      return;
    }
    default: break;
  }

  // fan-out 대상 (uri 없는 워크스페이스 질의)
  if (msg.method && FANOUT_METHODS.has(msg.method) && msg.id !== undefined) {
    const live = [...children.values()];
    if (live.length === 0) { toClient({ jsonrpc: '2.0', id: msg.id, result: [] }); return; }
    const origId = String(msg.id);
    const fan = { want: live.length, got: 0, items: [], rawId: msg.id, timer: null };
    fan.timer = setTimeout(() => {
      pendingFanouts.delete(origId);
      toClient({ jsonrpc: '2.0', id: fan.rawId, result: fan.items });
      log(`fan-out(${origId}) 타임아웃: ${fan.got}/${fan.want} 수신분 ${fan.items.length}건으로 응답`);
    }, 20000); // 신규 child 인덱싱 게이트(수 초)를 품을 수 있게 여유
    pendingFanouts.set(origId, fan);
    for (const c of live) {
      childSend(c, Object.assign({}, msg, { id: `fan:${c.idx}:${origId}` }));
    }
    log(`fan-out(${origId}) ${msg.method} → ${live.length} children`);
    return;
  }

  // uri 기반 라우팅 (textDocument/*, 기타 문서 요청)
  const uri = msg.params && msg.params.textDocument && msg.params.textDocument.uri;
  const ws = uri ? workspaceForUri(uri) : DEFAULT_WS;
  const child = ensureChild(ws);
  if (uri && cfg.log !== 'off' && ws !== DEFAULT_WS) log(`route → child#${child.idx} (ws=${ws})`);
  if (uri) {
    if (msg.method === 'textDocument/didOpen') child.opened.add(uri);
    else if (msg.method === 'textDocument/didClose') child.opened.delete(uri);
    else if (!child.opened.has(uri)) {
      // 하네스가 didOpen 을 생략하는 경우(파일 단위 북키핑이 서버 재시작을 모름) 대비 — 디스크에서 합성
      const p = uriToPath(uri);
      try {
        const text = fs.readFileSync(p, 'utf8');
        childSend(child, { jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
          textDocument: { uri, languageId: 'php', version: 0, text } } });
        child.opened.add(uri);
        log(`child#${child.idx} didOpen 합성: ${p}`);
      } catch (e) { log(`didOpen 합성 실패(${p}): ${e.message}`); }
    }
  }
  childSend(child, msg);
});
process.stdin.on('data', parseClient);
process.stdin.on('end', () => { for (const c of children.values()) { try { c.proc.stdin.end(); } catch (e) {} } });
process.on('SIGTERM', () => { for (const c of children.values()) { try { c.proc.kill('SIGTERM'); } catch (e) {} } process.exit(0); });
process.stdout.on('error', (e) => log(`stdout error(무시): ${e.code || e.message}`));
// 어떤 예외도 crash(exit≠0)로 이어지면 하네스가 respawn 을 멈춘다(실측) — 로그 남기고 생존
process.on('uncaughtException', (e) => log(`uncaughtException(생존): ${e.stack || e.message}`));
