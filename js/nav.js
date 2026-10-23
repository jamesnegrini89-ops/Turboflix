// Navegação por controle remoto (setas do Fire TV / Android TV / teclado).
// Move o foco para o elemento ".focusable" mais próximo na direção pressionada.

const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Up: 'up', Down: 'down', Left: 'left', Right: 'right' };
const CODES = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 19: 'up', 20: 'down', 21: 'left', 22: 'right' };

function visible(el) {
  if (el.disabled || el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function candidates() {
  const root = document.querySelector('#player:not([hidden])') ? null : document;
  if (!root) return [];
  return [...document.querySelectorAll('.focusable')].filter(visible);
}

function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

export function moveFocus(dir) {
  const els = candidates();
  if (!els.length) return false;
  const cur = document.activeElement;
  if (!cur || !els.includes(cur)) { focusEl(els[0]); return true; }

  const r = cur.getBoundingClientRect();
  const c = center(r);
  const list = els.filter((e) => e !== cur).map((el) => {
    const b = el.getBoundingClientRect();
    return { el, b, p: center(b) };
  });

  let best = null;
  if (dir === 'up' || dir === 'down') {
    const sign = dir === 'down' ? 1 : -1;
    const cands = list.filter((o) => (o.p.y - c.y) * sign > 8 && (dir === 'down' ? o.b.top >= r.top + 4 : o.b.bottom <= r.bottom - 4));
    if (!cands.length) return false;
    // linha mais próxima, depois o mais alinhado horizontalmente
    const minMain = Math.min(...cands.map((o) => Math.abs(o.p.y - c.y)));
    const row = cands.filter((o) => Math.abs(o.p.y - c.y) <= minMain + 40);
    best = row.reduce((a, o) => (Math.abs(o.p.x - c.x) < Math.abs(a.p.x - c.x) ? o : a), row[0]);
  } else {
    const sign = dir === 'right' ? 1 : -1;
    const cands = list.filter((o) => (o.p.x - c.x) * sign > 8);
    if (!cands.length) return false;
    const overlap = cands.filter((o) => o.b.top < r.bottom - 4 && o.b.bottom > r.top + 4);
    const pool = overlap.length ? overlap : cands;
    let bs = Infinity;
    for (const o of pool) {
      const s = Math.abs(o.p.x - c.x) + Math.abs(o.p.y - c.y) * (overlap.length ? 0.2 : 3);
      if (s < bs) { bs = s; best = o; }
    }
  }
  if (best) { focusEl(best.el); return true; }
  return false;
}

export function focusEl(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  // rola linhas horizontais e a página para manter o item visível
  try { el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } catch { el.scrollIntoView(false); }
}

export function focusFirst(selector = '.focusable') {
  const root = document.getElementById('view');
  const el = [...root.querySelectorAll(selector)].find(visible) || [...document.querySelectorAll('.focusable')].find(visible);
  if (el) focusEl(el);
}

export function initNav({ onBack } = {}) {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const dir = DIRS[e.key] || CODES[e.keyCode];
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');

    if (dir) {
      // dentro de campos de texto, setas laterais movem o cursor
      if (typing && (dir === 'left' || dir === 'right')) {
        const v = a.value || '';
        const atStart = a.selectionStart === 0 && a.selectionEnd === 0;
        const atEnd = a.selectionStart === v.length;
        if (!((dir === 'left' && atStart) || (dir === 'right' && atEnd))) return;
      }
      if (a && a.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) return;
      if (moveFocus(dir)) e.preventDefault();
      return;
    }
    const isBack = e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || e.keyCode === 4 ||
      (e.key === 'Backspace' && !typing);
    if (isBack && onBack) {
      e.preventDefault();
      onBack();
    }
  });
}
