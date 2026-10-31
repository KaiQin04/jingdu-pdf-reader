import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticPdfTextShare } from '../src/chat-context.mjs';

const options = () => ({ document: {}, filename: 'synthetic.pdf', pageCount: 2, enabled: true, readPage: async n => `Synthetic page ${n}` });
const host = sendMessage => ({ getHostCapabilities: () => ({ message: { text: {} } }), sendMessage });

test('disabled or unsupported automatic sharing reads and sends nothing, and can start when a host becomes available', async () => {
  const automatic = new AutomaticPdfTextShare(), input = options(); let reads = 0, sends = 0;
  input.readPage = async () => { reads++; return 'Synthetic'; };
  const app = host(async () => { sends++; return {}; });
  await automatic.start({ ...input, app, enabled: false });
  await automatic.start({ ...input, app: null });
  assert.equal(reads, 0); assert.equal(sends, 0); assert.equal(automatic.hasAttempted(input.document), false);
  await automatic.start({ ...input, app });
  assert.equal(reads, 2); assert.equal(sends, 1);
});

test('a PDF gets one whole-document message despite repeated startup and host-context events', async () => {
  const automatic = new AutomaticPdfTextShare(), input = options(), messages = [], phases = [];
  const app = host(async message => { messages.push(message); return {}; });
  const run = automatic.start({ ...input, app, onState: event => phases.push(event.phase) });
  await automatic.start({ ...input, app }); await run; await automatic.start({ ...input, app });
  assert.equal(messages.length, 1); assert.match(messages[0].content[0].text, /PDF page 1 ---\nSynthetic page 1/);
  assert.match(messages[0].content[0].text, /PDF page 2 ---\nSynthetic page 2/);
  assert.ok(phases.includes('prepared')); assert.ok(phases.includes('accepted')); assert.equal(phases.at(-1), 'settled');
  assert.equal(automatic.running, false);
});

test('turning automatic sharing off while extracting prevents a late read from being sent', async () => {
  const automatic = new AutomaticPdfTextShare(), input = options(); let release, sends = 0;
  input.readPage = () => new Promise(resolve => { release = resolve; });
  const app = host(async () => { sends++; return {}; });
  const run = automatic.start({ ...input, app });
  assert.equal(automatic.cancel(), false); release('Late synthetic text'); await run;
  await automatic.start({ ...input, app });
  assert.equal(sends, 0); assert.equal(automatic.running, false);
});

test('switching documents cannot send the old extraction or clear the new operation', async () => {
  const automatic = new AutomaticPdfTextShare(), sent = []; let release;
  const app = host(async message => { sent.push(message.content[0].text); return {}; });
  const old = automatic.start({ ...options(), app, filename: 'old-synthetic.pdf', readPage: () => new Promise(r => { release = r; }) });
  automatic.cancel();
  const next = automatic.start({ ...options(), app, filename: 'new-synthetic.pdf' });
  release('Old reference'); await Promise.all([old, next]);
  assert.equal(sent.length, 1); assert.match(sent[0], /new-synthetic.pdf/); assert.ok(!sent[0].includes('Old reference'));
});

test('uncertain delivery and explicit rejection are not automatically retried', async () => {
  for (const rejects of [false, true]) {
    const automatic = new AutomaticPdfTextShare(), input = options(), phases = []; let sends = 0;
    const app = host(async () => { sends++; if (rejects) return { isError: true }; throw Error('Synthetic transport timeout'); });
    await automatic.start({ ...input, app, onState: e => phases.push(e.phase) });
    await automatic.start({ ...input, app });
    assert.equal(sends, 1); assert.ok(phases.includes(rejects ? 'rejected' : 'unconfirmed')); assert.ok(!phases.includes('accepted'));
  }
});

test('losing host support before delivery sends nothing', async () => {
  const automatic = new AutomaticPdfTextShare(); let supported = true, sends = 0;
  const app = { getHostCapabilities: () => supported ? { message: { text: {} } } : {}, sendMessage: async () => { sends++; } };
  const states = [];
  await automatic.start({ ...options(), app, onState: e => { states.push(e); if (e.phase === 'prepared') supported = false; } });
  assert.equal(sends, 0); assert.ok(states.some(e => e.phase === 'failed' && e.code === 'UNAVAILABLE'));
});

test('turning off after delivery starts reports uncertainty and ignores a late acknowledgement', async () => {
  const automatic = new AutomaticPdfTextShare(), states = []; let acknowledge, started;
  const sending = new Promise(r => { started = r; });
  const run = automatic.start({ ...options(), app: host(() => { started(); return new Promise(r => { acknowledge = r; }); }), onState: e => states.push(e.phase) });
  await sending; assert.equal(automatic.cancel(), true); acknowledge({}); await run;
  assert.ok(!states.includes('accepted')); assert.equal(automatic.running, false);
});

test('image-only and over-limit documents fail without sending partial text', async () => {
  for (const extra of [{ readPage: async () => '' }, { pageCount: 201 }]) {
    const automatic = new AutomaticPdfTextShare(), states = []; let sends = 0;
    const input = { ...options(), ...extra, app: host(async () => { sends++; return {}; }), onState: e => states.push(e) };
    await automatic.start(input); await automatic.start(input);
    assert.equal(sends, 0); assert.equal(states.filter(e => e.phase === 'failed').length, 1);
  }
});
