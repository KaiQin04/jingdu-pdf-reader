import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

/** Bundle the same offline parser for the browser and decoder regression tests. */
export async function bundlePdfWorker(format = 'iife') {
  const directory = new URL('../node_modules/pdfjs-dist/build/', import.meta.url);
  let source = await readFile(new URL('pdf.worker.mjs', directory), 'utf8');
  // PDF.js 6 loads CCITT/JBIG2 and JPEG 2000 JS fallbacks by dynamic URL.
  // The reader forbids network access and WASM compilation. Resolve the two
  // pinned upstream modules at build time instead, without changing that CSP.
  const dynamicImport = 'await import(\n      /*webpackIgnore: true*/\n      /*@vite-ignore*/\n      `${WasmImage.#wasmUrl}${this._noWasmFilename}`)';
  if (source.split(dynamicImport).length !== 2) {
    throw new Error('PDF.js fallback loader changed; review offline decoder integration');
  }
  source = `import offlineJbig2 from '../wasm/jbig2_nowasm_fallback.js';
import offlineOpenjpeg from '../wasm/openjpeg_nowasm_fallback.js';
const offlineImageDecoders = Object.freeze({
  'jbig2_nowasm_fallback.js': offlineJbig2,
  'openjpeg_nowasm_fallback.js': offlineOpenjpeg,
});\n` + source.replace(dynamicImport, '({ default: offlineImageDecoders[this._noWasmFilename] })');
  const result = await build({
    stdin: { contents: source, sourcefile: 'pdf.worker.mjs', resolveDir: directory.pathname },
    bundle: true, write: false, format, platform: 'browser', target: 'es2022',
    minify: true, legalComments: 'none', logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}
