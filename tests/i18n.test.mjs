import test from 'node:test';
import assert from 'node:assert/strict';
import { AnnotationStore } from '../src/annotations.mjs';

const api = await import('../src/i18n.mjs').catch(() => ({}));

function translator(language) {
  assert.equal(typeof api.createI18n, 'function');
  return api.createI18n(language);
}

function element({ text = '', value = '', attributes = {} } = {}) {
  const attrs = new Map(Object.entries(attributes));
  return {
    textContent: text,
    value,
    dataset: {},
    getAttribute: name => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: name => attrs.delete(name),
  };
}

function documentWith(...elements) {
  return {
    documentElement: { lang: 'en' },
    querySelectorAll(selector) {
      const attrs = [...selector.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
      return elements.filter(el => attrs.some(name => el.getAttribute(name) !== null));
    },
  };
}

test('English default formats page context without interpreting document text', () => {
  const i18n = translator();
  assert.equal(i18n.language, 'en');
  const context = '<img src=x onerror=alert(1)> 原文 {page}';
  assert.equal(i18n.t('searchResult', { page: 2, context }), `Page 2 · ${context}`);
  i18n.setLanguage('zh-Hant');
  assert.equal(i18n.t('searchResult', { page: 2, context }), `第 2 頁 · ${context}`);
});

test('switching language updates UI bindings while keeping file and document content intact', () => {
  const i18n = translator();
  const page = element();
  const file = element({ value: 'synthetic.pdf' });
  const documentText = element({ text: '搜尋 與標示 are original PDF text' });
  const note = element({ value: '我的註記 <b>plain text</b>' });
  const root = documentWith(page, file, documentText, note);
  i18n.text(page, 'pageLabel', { page: 3 });
  assert.equal(page.textContent, 'Page 3');
  i18n.setLanguage('zh-Hant', root);
  assert.equal(page.textContent, '第 3 頁');
  assert.equal(root.documentElement.lang, 'zh-Hant');
  assert.equal(file.value, 'synthetic.pdf');
  assert.equal(documentText.textContent, '搜尋 與標示 are original PDF text');
  assert.equal(note.value, '我的註記 <b>plain text</b>');
});

test('a filename and an export stop following UI translations once replaced with user data', () => {
  const i18n = translator();
  const filename = element();
  const preview = element();
  const root = documentWith(filename, preview);
  i18n.text(filename, 'readerReady');
  i18n.value(preview, 'exportChanged');
  i18n.clearText(filename);
  filename.textContent = '搜尋.pdf';
  i18n.clearValue(preview);
  preview.value = '{"text":"搜尋 原文"}';
  i18n.setLanguage('zh-Hant', root);
  assert.equal(filename.textContent, '搜尋.pdf');
  assert.equal(preview.value, '{"text":"搜尋 原文"}');
});

test('nested status messages change language together and option values keep schema identifiers', () => {
  const i18n = translator();
  const status = element();
  const color = element({ value: 'yellow' });
  const root = documentWith(status, color);
  i18n.text(status, 'errorWithNotes', { reason: i18n.message('errorEmpty') });
  i18n.text(color, 'color.yellow');
  assert.match(status.textContent, /empty/i);
  i18n.setLanguage('zh-TW', root);
  assert.match(status.textContent, /文件是空的/);
  assert.equal(color.textContent, '黃色');
  assert.equal(color.value, 'yellow');
  assert.equal(i18n.language, 'zh-Hant');
});

test('unsupported locales fall back to English without retaining the previous language', () => {
  const i18n = translator('zh-Hant');
  i18n.setLanguage('fr-FR');
  assert.equal(i18n.language, 'en');
  assert.equal(i18n.t('pageLabel', { page: 4 }), 'Page 4');
});

test('English Markdown export localizes headings while preserving notes and JSON schema', () => {
  const store = new AnnotationStore({
    fingerprints: ['a'.repeat(32)], pageCount: 2, filename: '搜尋.pdf',
  });
  store.add({ type: 'comment', page: 2, text: '原文筆記', quote: '引用保留' });
  const before = store.exportJSON();
  const english = store.exportMarkdown('en');
  assert.match(english, /^# PDF reading notes/m);
  assert.match(english, /PDF page 2/);
  assert.ok(english.includes('原文筆記'));
  assert.ok(english.includes('引用保留'));
  assert.equal(store.exportJSON(), before);
  assert.match(store.exportMarkdown('zh-Hant'), /PDF 第 2 頁/);
});
