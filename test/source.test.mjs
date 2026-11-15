import test from 'node:test';
import assert from 'node:assert/strict';
import { startProvider } from '../provider/source.mjs';

test("来源实际交互保持已声明的语义", async () => {
  const source = await startProvider();
  try {
    const net = await import('node:net');
    const client = net.createConnection({ port: source.port, host: '127.0.0.1' });
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
    const messages = [];
    const waitFor = predicate => new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('LSP消息未返回')), 2000);
      const check = () => {
        const match = messages.find(predicate);
        if (match) { clearTimeout(deadline); resolve(match); }
      };
      client.on('data', () => queueMicrotask(check));
      check();
    });
    let pending = Buffer.alloc(0);
    client.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      const delimiter = Buffer.from('\r\n\r\n');
      while (pending.includes(delimiter)) {
        const boundary = pending.indexOf(delimiter);
        const length = Number(/Content-Length: (\d+)/i.exec(pending.subarray(0, boundary).toString())?.[1]);
        if (pending.length < boundary + 4 + length) break;
        messages.push(JSON.parse(pending.subarray(boundary + 4, boundary + 4 + length).toString()));
        pending = pending.subarray(boundary + 4 + length);
      }
    });
    const send = message => { const body = Buffer.from(JSON.stringify(message)); client.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])); };
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'test-client' }, capabilities: {} } });
    const initialized = await waitFor(message => message.id === 1);
    assert.equal(initialized.result.serverInfo.name, 'local-diagnostic-source');
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({ jsonrpc: '2.0', id: 2, method: 'textDocument/diagnostic', params: { textDocument: { uri: 'file:///workspace/a.js' }, previousResultId: 'a-r1' } });
    const report = await waitFor(message => message.id === 2);
    assert.equal(report.result.kind, 'unchanged');
    client.destroy();
  } finally { await source.close(); }
});
