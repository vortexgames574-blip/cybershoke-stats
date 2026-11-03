/* docs/player-aliases.js
   Алиасы ников: подменяем только отображение на странице.
   Данные в docs/data/stats.json и ключи localStorage (savedTeams_*, bracket_*)
   остаются с исходным ником — старые сохранения продолжают работать.
*/
(() => {
  'use strict';

  // Точное совпадение: сырое имя из stats.json → отображаемое имя.
  const PLAYER_ALIASES = new Map([
    ['BB-00 (5015)', 'q1nce_'],
  ]);

  // Запасной вариант: если сервер отдаёт "BB-00" отдельным полем,
  // а "(5015)" дорисовывается шаблоном. Срабатывает только если точного
  // совпадения выше не было.
  const PLAYER_PATTERNS = [
    [/BB-00(?!\d)/g, 'q1nce_'],
  ];

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE',
  ]);
  const SKIP_ATTRS = ['title', 'aria-label', 'alt'];

  const exactPairs = [...PLAYER_ALIASES.entries()]
    .filter(([raw, alias]) => raw && raw !== alias)
    .sort((a, b) => b[0].length - a[0].length);

  if (exactPairs.length === 0 && PLAYER_PATTERNS.length === 0) return;

  function replaceString(value) {
    if (typeof value !== 'string' || value === '') return value;
    let out = value;
    for (const [raw, alias] of exactPairs) {
      if (out.includes(raw)) out = out.split(raw).join(alias);
    }
    for (const [re, alias] of PLAYER_PATTERNS) {
      out = out.replace(re, alias);
    }
    return out;
  }

  function isSkipped(el) {
    return !el || SKIP_TAGS.has(el.tagName);
  }

  function fixTextNode(node) {
    const next = replaceString(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function fixElementAttrs(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    for (const name of SKIP_ATTRS) {
      const value = el.getAttribute(name);
      if (!value) continue;
      const next = replaceString(value);
      if (next !== value) el.setAttribute(name, next);
    }
  }

  function walk(root) {
    if (!root) return;

    if (root.nodeType === Node.TEXT_NODE) {
      if (!isSkipped(root.parentElement)) fixTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (isSkipped(root)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isSkipped(node.parentElement)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });

    let node = walker.nextNode();
    while (node) {
      fixTextNode(node);
      node = walker.nextNode();
    }

    fixElementAttrs(root);
    for (const el of root.querySelectorAll('[title],[aria-label],[alt]')) {
      fixElementAttrs(el);
    }
  }

  // Пакетная обработка: несколько мутаций за кадр — один проход.
  const pending = new Set();
  let scheduled = false;

  function flush() {
    scheduled = false;
    const roots = [...pending];
    pending.clear();
    for (const root of roots) {
      if (root && root.isConnected !== false) walk(root);
    }
  }

  function schedule(node) {
    if (!node) return;
    pending.add(node);
    if (scheduled) return;
    scheduled = true;
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(flush);
    } else {
      window.setTimeout(flush, 0);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        schedule(m.target);
      } else if (m.type === 'childList') {
        for (const n of m.addedNodes) schedule(n);
      }
    }
  });

  function boot() {
    if (!document.body) return;
    walk(document.body);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
