import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { bundlePdfWorker } from '../scripts/pdf-worker.mjs';
import { pdfOptions } from '../src/pdf-policy.mjs';
import { makeCcittPdf } from './scan-fixture.mjs';

test('offline worker paints CCITT scan pixels as well as extracting its text layer', async () => {
  const source = await bundlePdfWorker('esm');
  const previous = globalThis.pdfjsWorker;
  globalThis.pdfjsWorker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const task = getDocument(pdfOptions(new Uint8Array(makeCcittPdf())));
  try {
    const doc = await task.promise, page = await doc.getPage(1);
    assert.equal((await page.getTextContent()).items.map(item => item.str).join(''), 'SYNTHETIC OCR TEXT');
    const viewport = page.getViewport({ scale: 1 }), canvas = createCanvas(612, 792);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode: AnnotationMode.DISABLE }).promise;
    const pixel = [...canvas.getContext('2d').getImageData(100, 200, 1, 1).data];
    assert.deepEqual(pixel, [0, 0, 0, 255], 'a readable text layer must not hide a missing scan decoder');
  } finally {
    await task.destroy(); globalThis.pdfjsWorker = previous;
  }
});
