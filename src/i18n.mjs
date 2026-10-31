/** Session-only UI localization. Document text is never discovered or translated. */
import { MESSAGES } from './translations.mjs';

const FIELDS = new Map([
  ['textContent', 'data-i18n'],
  ['value', 'data-i18n-value'],
  ['title', 'data-i18n-title'],
  ['aria-label', 'data-i18n-aria-label'],
  ['placeholder', 'data-i18n-placeholder'],
  ['alt', 'data-i18n-alt'],
]);
const SELECTOR = [...FIELDS.values()].map(name => `[${name}]`).join(',');

function normalizeLocale(language) {
  return typeof language === 'string' && /^zh(?:-|$)/i.test(language)
    ? 'zh-Hant' : 'en';
}

function render(message, language, depth = 0) {
  if (depth > 8 || !message || !Object.hasOwn(MESSAGES, message.key)) {
    throw new Error('Unknown or recursive UI message');
  }
  const template = MESSAGES[message.key][language];
  if (typeof template !== 'string') throw new Error('Missing UI translation');
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!Object.hasOwn(message.values, key)) throw new Error('Missing UI value');
    const value = message.values[key];
    return value && typeof value === 'object' && Object.hasOwn(value, 'key')
      ? render(value, language, depth + 1) : String(value);
  });
}

/** Format an owned UI message without inspecting or executing its values. */
export function formatMessage(key, values = {}, language = 'en') {
  return render({ key, values }, normalizeLocale(language));
}

/** Bind only explicitly tagged UI nodes; retain no storage or network handles. */
export function createI18n(language = 'en') {
  let current = normalizeLocale(language);
  const bindings = new WeakMap();
  const message = (key, values = {}) => ({ key, values });
  const t = (key, values = {}) => formatMessage(key, values, current);

  function assign(element, property, text) {
    if (property === 'textContent' || property === 'value') element[property] = text;
    else element.setAttribute(property, text);
  }

  function bind(element, property, key, values = {}) {
    const descriptor = typeof key === 'string' ? message(key, values) : key;
    const attribute = FIELDS.get(property);
    if (!attribute) throw new Error('Unsupported UI translation property');
    let record = bindings.get(element);
    if (!record) bindings.set(element, record = new Map());
    record.set(property, descriptor);
    element.setAttribute(attribute, descriptor.key);
    assign(element, property, render(descriptor, current));
  }

  function clear(element, property) {
    bindings.get(element)?.delete(property);
    element.removeAttribute(FIELDS.get(property));
  }

  function apply(root) {
    if (!root) return;
    const elements = [...root.querySelectorAll(SELECTOR)];
    if (root.getAttribute && [...FIELDS.values()].some(name => root.getAttribute(name) !== null)) {
      elements.unshift(root);
    }
    for (const element of elements) {
      for (const [property, attribute] of FIELDS) {
        const key = element.getAttribute(attribute);
        if (key === null) continue;
        const record = bindings.get(element)?.get(property);
        const descriptor = record?.key === key ? record : message(key);
        assign(element, property, render(descriptor, current));
      }
    }
  }

  return {
    get language() { return current; },
    message,
    t,
    text: (element, key, values) => bind(element, 'textContent', key, values),
    value: (element, key, values) => bind(element, 'value', key, values),
    attribute: (element, property, key, values) => bind(element, property, key, values),
    clearText: element => clear(element, 'textContent'),
    clearValue: element => clear(element, 'value'),
    apply,
    setLanguage(next, root) {
      current = normalizeLocale(next);
      if (root?.documentElement) root.documentElement.lang = current;
      apply(root);
      return current;
    },
  };
}
