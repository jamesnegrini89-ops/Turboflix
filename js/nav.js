// Navegação por controle remoto (setas do Fire TV / Android TV / teclado).
// Possui suporte dedicado para:
// - Grade de catálogo (#grid em Filmes, Séries, Canais, Busca e Minha Lista) com rolagem vertical por linha/coluna
// - Barra lateral de categorias (.grp-list) isolada da grade principal
// - Carrosséis horizontais (.row, .hubs, .seasons, .chips, #mainnav)
// - Lista de episódios (.episodes)

const DIRS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Up: 'up', Down: 'down', Left: 'left', Right: 'right'
};
const CODES = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 19: 'up', 20: 'down', 21: 'left', 22: 'right' };

function visible(el) {
  if (!el || el.disabled || el.hidden || el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function candidates(root = document) {
  if (document.querySelector('#player:not([hidden])')) return [];
  return [...root.querySelectorAll('.focusable')].filter(visible);
}

function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

/** Calcula quantas colunas existem atualmente em uma grade CSS (.grid). */
function getGridCols(grid, cards) {
  if (!grid || cards.length <= 1) return 1;
  try {
    const tpl = window.getComputedStyle(grid).gridTemplateColumns;
    if (tpl && tpl !== 'none') {
      const cols = tpl.trim().split(/\s+/).length;
      if (cols >= 1) return cols;
    }
  } catch {}
  const top0 = cards[0].offsetTop;
  for (let i = 1; i < Math.min(cards.length, 30); i++) {
    if (Math.abs(cards[i].offsetTop - top0) > 24) return i;
  }
  return cards.length;
}

/** Rola contêineres internos (.browse-main, .grp-list, .row, etc.) e a janela de forma imediata e sem travar no Fire TV. */
function scrollIntoViewSmart(el) {
  if (!el) return;

  // 1. Rolagem horizontal em carrosséis (.row, .hubs, .seasons, .chips, .grp-list mobile)
  const hScroll = el.closest('.row, .hubs, .seasons, .chips, .grp-list');
  if (hScroll && hScroll.scrollWidth > hScroll.clientWidth + 4) {
    const er = el.getBoundingClientRect();
    const hr = hScroll.getBoundingClientRect();
    const padX = 40;
    if (er.left < hr.left + padX) {
      hScroll.scrollLeft -= (hr.left + padX - er.left);
    } else if (er.right > hr.right - padX) {
      hScroll.scrollLeft += (er.right - (hr.right - padX));
    }
  }

  // 2. Rolagem vertical em painéis com scroll próprio (.browse-main, .grp-list, .cast-box)
  const vScroll = el.closest('.browse-main, .grp-list, .cast-box, .p-cast-modal');
  if (vScroll && vScroll.scrollHeight > vScroll.clientHeight + 4) {
    const er = el.getBoundingClientRect();
    const vr = vScroll.getBoundingClientRect();
    const padTop = 56;
    const padBot = 56;
    if (er.top < vr.top + padTop) {
      vScroll.scrollTop -= (vr.top + padTop - er.top);
    } else if (er.bottom > vr.bottom - padBot) {
      vScroll.scrollTop += (er.bottom - (vr.bottom - padBot));
    }
    return;
  }

  // 3. Rolagem vertical da página principal (Início, Detalhes, Busca, Minha Lista, Configurações)
  const er = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const padTop = 88;
  const padBot = 48;
  if (er.top < padTop) {
    window.scrollBy(0, er.top - padTop);
  } else if (er.bottom > vh - padBot) {
    window.scrollBy(0, er.bottom - (vh - padBot));
  }
}

export function focusEl(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  scrollIntoViewSmart(el);
}

export function focusFirst(selector = '.focusable') {
  const root = document.getElementById('view');
  const el = (root && [...root.querySelectorAll(selector)].find(visible)) || [...document.querySelectorAll('.focusable')].find(visible);
  if (el) focusEl(el);
}

/** Busca o elemento focável mais próximo geometricamente dentro de um conjunto específico. */
function findGeometricBest(cur, poolEls, dir) {
  const r = cur.getBoundingClientRect();
  const c = center(r);
  const list = poolEls.filter((e) => e !== cur && visible(e)).map((el) => {
    const b = el.getBoundingClientRect();
    return { el, b, p: center(b) };
  });
  if (!list.length) return null;

  if (dir === 'up' || dir === 'down') {
    const sign = dir === 'down' ? 1 : -1;
    const cands = list.filter((o) => (o.p.y - c.y) * sign > 8 && (dir === 'down' ? o.b.top >= r.top + 4 : o.b.bottom <= r.bottom - 4));
    if (!cands.length) return null;
    const minMain = Math.min(...cands.map((o) => Math.abs(o.p.y - c.y)));
    const row = cands.filter((o) => Math.abs(o.p.y - c.y) <= minMain + 45);
    return row.reduce((a, o) => (Math.abs(o.p.x - c.x) < Math.abs(a.p.x - c.x) ? o : a), row[0])?.el || null;
  } else {
    const sign = dir === 'right' ? 1 : -1;
    const cands = list.filter((o) => (o.p.x - c.x) * sign > 8);
    if (!cands.length) return null;
    const overlap = cands.filter((o) => o.b.top < r.bottom - 4 && o.b.bottom > r.top + 4);
    const pool = overlap.length ? overlap : cands;
    let best = null, bs = Infinity;
    for (const o of pool) {
      const s = Math.abs(o.p.x - c.x) + Math.abs(o.p.y - c.y) * (overlap.length ? 0.2 : 3);
      if (s < bs) { bs = s; best = o; }
    }
    return best?.el || null;
  }
}

export function moveFocus(dir) {
  const els = candidates();
  if (!els.length) return false;
  const cur = document.activeElement;
  if (!cur || !els.includes(cur)) { focusEl(els[0]); return true; }

  // ================================================================
  // 1. NAVEGAÇÃO NA LISTA LATERAL DE CATEGORIAS (.grp-list em .browse)
  // ================================================================
  const grpList = cur.closest('.grp-list');
  if (grpList) {
    const grps = [...grpList.querySelectorAll('.grp.focusable')].filter(visible);
    const idx = grps.indexOf(cur);
    if (idx >= 0) {
      if (dir === 'down') {
        if (idx + 1 < grps.length) { focusEl(grps[idx + 1]); return true; }
        return true; // fim da lista de categorias: não pula para o lado
      }
      if (dir === 'up') {
        if (idx > 0) { focusEl(grps[idx - 1]); return true; }
        const navBtn = document.querySelector('#topbar .nav-btn.active') || document.querySelector('#topbar .nav-btn');
        if (navBtn && visible(navBtn)) { focusEl(navBtn); return true; }
        return true;
      }
      if (dir === 'right') {
        const browseMain = document.querySelector('.browse-main');
        if (browseMain) {
          const cards = [...browseMain.querySelectorAll('.card.focusable')].filter(visible);
          if (cards.length) {
            // Foca o primeiro card visível dentro da área atual de .browse-main
            const bmRect = browseMain.getBoundingClientRect();
            const firstVisible = cards.find((c) => {
              const cr = c.getBoundingClientRect();
              return cr.top >= bmRect.top - 20 && cr.bottom <= bmRect.bottom + 80;
            }) || cards[0];
            focusEl(firstVisible);
            return true;
          }
        }
      }
      if (dir === 'left') return true;
    }
  }

  // ================================================================
  // 2. NAVEGAÇÃO EM QUALQUER GRADE DE CARDS (.grid — Filmes, Séries, Canais, Busca, Minha Lista)
  // ================================================================
  const grid = cur.closest('.grid');
  if (grid && cur.classList.contains('card')) {
    let cards = [...grid.querySelectorAll('.card.focusable')].filter(visible);
    const idx = cards.indexOf(cur);
    if (idx >= 0) {
      const cols = getGridCols(grid, cards);
      const col = idx % cols;

      if (dir === 'down') {
        // Se estiver perto do fim dos itens renderizados na grade, carrega mais itens automaticamente
        if (idx + cols * 2 >= cards.length && typeof grid._loadMore === 'function') {
          grid._loadMore();
          cards = [...grid.querySelectorAll('.card.focusable')].filter(visible);
        }
        if (idx + cols < cards.length) {
          focusEl(cards[idx + cols]);
          return true;
        }
        // Se a última linha tiver menos colunas que a linha atual, foca o último item da última linha
        const currentRowStart = idx - col;
        if (currentRowStart + cols < cards.length) {
          focusEl(cards[cards.length - 1]);
          return true;
        }
        // Se houver outra seção abaixo (ex.: na tela de Busca ou Minha Lista), desce para ela
        if (!grid.closest('.browse-main')) {
          const below = findGeometricBest(cur, els.filter((e) => !grid.contains(e) && !e.closest('.groups')), 'down');
          if (below) { focusEl(below); return true; }
        }
        return true;
      }

      if (dir === 'up') {
        if (idx - cols >= 0) {
          focusEl(cards[idx - cols]);
          return true;
        }
        // Está na primeira linha da grade: sobe para o componente acima (chips de busca, seção anterior ou #topbar)
        const abovePool = els.filter((e) => !grid.contains(e) && !e.closest('.groups'));
        const above = findGeometricBest(cur, abovePool, 'up')
          || document.querySelector('#topbar .nav-btn.active')
          || document.querySelector('#topbar .nav-btn');
        if (above && visible(above)) { focusEl(above); return true; }
        return true;
      }

      if (dir === 'left') {
        if (col > 0 && idx - 1 >= 0) {
          focusEl(cards[idx - 1]);
          return true;
        }
        // Está na primeira coluna da esquerda da grade: se estiver em .browse, volta para a lista de categorias à esquerda
        const groups = document.querySelector('.browse .groups');
        if (groups) {
          const selGrp = groups.querySelector('.grp.sel') || groups.querySelector('.grp.focusable');
          if (selGrp && visible(selGrp)) { focusEl(selGrp); return true; }
        }
        return true;
      }

      if (dir === 'right') {
        if (col + 1 < cols && idx + 1 < cards.length) {
          focusEl(cards[idx + 1]);
          return true;
        }
        return true;
      }
    }
  }

  // ================================================================
  // 3. NAVEGAÇÃO EM CARROSSÉIS HORIZONTAIS (.row, .hubs, .seasons, .chips, #mainnav)
  // ================================================================
  const hContainer = cur.closest('.row, .hubs, .seasons, .chips, #mainnav');
  if (hContainer && (dir === 'left' || dir === 'right')) {
    const items = [...hContainer.querySelectorAll('.focusable')].filter(visible);
    const idx = items.indexOf(cur);
    if (idx >= 0) {
      const nextIdx = dir === 'right' ? idx + 1 : idx - 1;
      if (nextIdx >= 0 && nextIdx < items.length) {
        focusEl(items[nextIdx]);
        return true;
      }
      return true;
    }
  }

  // ================================================================
  // 4. NAVEGAÇÃO NA LISTA DE EPISÓDIOS (.episodes)
  // ================================================================
  const epContainer = cur.closest('.episodes');
  if (epContainer && cur.classList.contains('ep')) {
    const eps = [...epContainer.querySelectorAll('.ep.focusable')].filter(visible);
    const idx = eps.indexOf(cur);
    if (idx >= 0) {
      if (dir === 'down') {
        if (idx + 1 < eps.length) focusEl(eps[idx + 1]);
        return true;
      }
      if (dir === 'up') {
        if (idx > 0) { focusEl(eps[idx - 1]); return true; }
        const seasonBtn = document.querySelector('#seasons .season.sel') || document.querySelector('#seasons .season') || document.querySelector('#sactions .btn');
        if (seasonBtn && visible(seasonBtn)) focusEl(seasonBtn);
        return true;
      }
    }
  }

  // ================================================================
  // 5. SAINDO DA #topbar PARA BAIXO NA TELA .browse
  // ================================================================
  if (cur.closest('#topbar') && dir === 'down') {
    const browseMain = document.querySelector('.browse-main');
    if (browseMain) {
      const cards = [...browseMain.querySelectorAll('.card.focusable')].filter(visible);
      if (cards.length) {
        const bmRect = browseMain.getBoundingClientRect();
        const firstVisible = cards.find((c) => {
          const cr = c.getBoundingClientRect();
          return cr.top >= bmRect.top - 20 && cr.bottom <= bmRect.bottom + 80;
        }) || cards[0];
        focusEl(firstVisible);
        return true;
      }
    }
  }

  // ================================================================
  // 6. NAVEGAÇÃO GEOMÉTRICA GERAL (Início, Detalhes, Login, Configurações)
  // ================================================================
  const best = findGeometricBest(cur, els, dir);
  if (best) {
    focusEl(best);
    return true;
  }
  return false;
}

export function initNav({ onBack } = {}) {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const dir = DIRS[e.key] || CODES[e.keyCode];
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');

    if (dir) {
      // Dentro de campos de texto, setas laterais movem o cursor até as extremidades
      if (typing && (dir === 'left' || dir === 'right')) {
        const v = a.value || '';
        const atStart = a.selectionStart === 0 && a.selectionEnd === 0;
        const atEnd = a.selectionStart === v.length;
        if (!((dir === 'left' && atStart) || (dir === 'right' && atEnd))) return;
      }
      if (a && a.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) return;
      moveFocus(dir);
      e.preventDefault();
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
