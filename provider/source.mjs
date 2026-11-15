import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';

const state = JSON.parse(await readFile(new URL('../fixtures/state.json', import.meta.url)));
const sessions = new Map();
let serial = 0;
function frame(message) { const body = Buffer.from(JSON.stringify(message)); return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]); }
function parseFrames(buffer) {
  const messages = [];
  while (buffer.includes(Buffer.from('\r\n\r\n'))) {
    const boundary = buffer.indexOf(Buffer.from('\r\n\r\n'));
    const header = buffer.subarray(0, boundary).toString();
    const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1]);
    const start = boundary + 4;
    if (buffer.length < start + length) break;
    messages.push(JSON.parse(buffer.subarray(start, start + length).toString()));
    buffer = buffer.subarray(start + length);
  }
  return { messages, remainder: buffer };
}
function session(id) {
  if (!sessions.has(id)) sessions.set(id, { id, ready: false, currentVersion: 1, reports: new Map(), nextDiagnostic: null, nextResultId: 1, cancelled: new Set(), cacheEpoch: id });
  return sessions.get(id);
}
function response(s, message) { if (s.socket) s.socket.write(frame(message)); }
export async function startProvider(options = {}) {
  let current;
  const server = createServer(async socket => {
    const s = session(++serial);
    current = s;
    s.socket = socket;
    let input = Buffer.alloc(0);
    socket.on('data', chunk => {
      input = Buffer.concat([input, chunk]);
      const parsed = parseFrames(input); input = parsed.remainder;
      for (const message of parsed.messages) dispatch(s, message);
    });
    socket.on('close', () => { s.ready = false; s.socket = null; });
  });
  function dispatch(s, message) {
    if (message.method === 'initialize') {
      s.client = message.params?.clientInfo?.name;
      response(s, { jsonrpc: '2.0', id: message.id, result: { capabilities: { textDocumentSync: 2, diagnosticProvider: { identifier: 'synth', interFileDependencies: true, workspaceDiagnostics: true, workDoneProgress: true } }, serverInfo: { name: 'local-diagnostic-source', version: `session-${s.id}` } } });
    } else if (message.method === 'initialized') s.ready = true;
    else if (message.method === '$/cancelRequest') { if (s.nextDiagnostic) s.cancelled.add(s.nextDiagnostic); }
    else if (message.method === 'textDocument/didChange') {
      s.currentVersion = message.params.textDocument.version;
      s.reports.set(message.params.textDocument.uri, { kind: 'full', resultId: `a-v${s.currentVersion}`, items: [] });
    } else if (message.method === 'textDocument/diagnostic') {
      const uri = message.params.textDocument.uri;
      const previous = message.params.previousResultId;
      const known = s.reports.get(uri) ?? state.reports[uri];
      if (known.resultId === previous) response(s, { jsonrpc: '2.0', id: message.id, result: { kind: 'unchanged', resultId: known.resultId } });
      else response(s, { jsonrpc: '2.0', id: message.id, result: { kind: 'full', resultId: known.resultId, items: known.items, version: s.currentVersion } });
    } else if (message.method === 'workspace/diagnostic') {
      const id = message.id; s.nextDiagnostic = id;
      const partial = options.scenario === 'partial';
      const items = [...s.reports.entries()];
      for (const [uri, report] of Object.entries(state.reports)) if (!s.reports.has(uri)) items.push([uri, report]);
      const first = items.slice(0, partial ? 1 : items.length);
      response(s, { jsonrpc: '2.0', method: '$/progress', params: { token: message.params.partialResultToken, value: { items: first.map(([uri, report]) => ({ uri, version: s.currentVersion, kind: 'full', resultId: report.resultId, items: report.items })) } } });
      if (partial && s.cancelled.has(id)) { s.nextDiagnostic = null; return; }
      const remaining = items.slice(first.length);
      response(s, { jsonrpc: '2.0', id, result: { items: [], ...(partial ? {} : { items: remaining.map(([uri, report]) => ({ uri, version: s.currentVersion, kind: 'full', resultId: report.resultId, items: report.items })) }) } });
      s.nextDiagnostic = null;
    } else if (message.id !== undefined) response(s, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve); });
  return { url: `tcp://127.0.0.1:${server.address().port}`, port: server.address().port, state, sessions, get currentSession() { return current; }, async close() { for (const s of sessions.values()) s.socket?.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
