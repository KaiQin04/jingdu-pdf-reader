export const LIMITS = Object.freeze({
  fileBytes: 500 * 1024 * 1024,
  pages: 5000,
  operationMs: 15000,
  searchMs: 15000,
  searchBatchPages: 250,
  cachedPages: 4,
  rangeChunkBytes: 256 * 1024,
  rangeRequestBytes: 64 * 1024 * 1024,
  canvasPixels: 12_000_000,
  imagePixels: 16_000_000,
  pageChars: 200_000,
  pageItems: 30_000,
  totalChars: 2_000_000,
  matches: 200,
  quoteChars: 4000,
});
export function checkFile(file) {
  if (!file || file.size === 0) throw new Error('EMPTY');
  if (file.size > LIMITS.fileBytes) throw new Error('SIZE');
}
export function normalizedText(text) {
  return text.normalize('NFKC').toLocaleLowerCase();
}
