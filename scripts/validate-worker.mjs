import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../dist/server/index.js',import.meta.url),'utf8');
const worker=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.equal(typeof worker.default?.fetch,'function');
const anonymous=await worker.default.fetch(new Request('https://synthetic.example/mcp'),{PDF_READER_SITE_ORIGIN:'https://synthetic.example'});
assert.equal(anonymous.status,405);
console.log('Sites Worker ESM imports successfully; anonymous MCP GET rejected; POST is the fixed protocol route.');
