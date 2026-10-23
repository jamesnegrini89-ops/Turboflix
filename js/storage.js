// Armazenamento local: configuração da lista, ajustes, Minha Lista (favoritos),
// Continuar Assistindo (progresso) e cache da lista em IndexedDB.

const K = { cfg: 'tf_cfg', set: 'tf_settings', fav: 'tf_favorites', prog: 'tf_progress' };

function read(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('storage', e); }
}

const DEFAULT_SETTINGS = {
  proxy: '',            // URL do proxy (Cloudflare Worker) - opcional
  liveFormat: 'ts',     // formato preferido dos canais Xtream: 'ts' abre direto sem esperar playlist HLS
  cacheHours: 12        // tempo que a lista fica em cache antes de recarregar
};

/** Remove campos pesados antes de salvar um item. */
function slim(item) {
  const { episodes, ...rest } = item;
  return rest;
}

export const Store = {
  // ---- Lista configurada (M3U ou Xtream) ----
  get cfg() { return read(K.cfg, null); },
  set cfg(v) { v ? write(K.cfg, v) : localStorage.removeItem(K.cfg); },

  // ---- Ajustes ----
  get settings() { return { ...DEFAULT_SETTINGS, ...read(K.set, {}) }; },
  setSetting(key, val) { const s = this.settings; s[key] = val; write(K.set, s); },

  // ---- Minha Lista ----
  favorites() { return read(K.fav, []); },
  isFav(id) { return this.favorites().some((f) => f.id === id); },
  toggleFav(item) {
    let list = this.favorites();
    const exists = list.some((f) => f.id === item.id);
    list = exists ? list.filter((f) => f.id !== item.id) : [slim(item), ...list];
    write(K.fav, list);
    return !exists;
  },
  clearFavorites() { write(K.fav, []); },

  // ---- Continuar Assistindo ----
  progressMap() { return read(K.prog, {}); },
  getProgress(id) { return this.progressMap()[id] || null; },
  saveProgress(item, pos, dur) {
    const map = this.progressMap();
    const isLive = item.type === 'live';
    if (!isLive) {
      if (!dur || !isFinite(dur) || pos < 15) return;
      if (pos / dur > 0.95) { delete map[item.id]; write(K.prog, map); return; } // terminou
    }
    map[item.id] = { item: slim(item), pos: isLive ? 0 : pos, dur: isLive ? 0 : dur, t: Date.now() };
    // mantém no máximo 150 itens
    const keys = Object.keys(map).sort((a, b) => map[b].t - map[a].t);
    keys.slice(150).forEach((k) => delete map[k]);
    write(K.prog, map);
  },
  removeProgress(id) { const m = this.progressMap(); delete m[id]; write(K.prog, m); },
  continueList(includeLive = true) {
    const m = this.progressMap();
    return Object.values(m)
      .filter((p) => includeLive || p.item.type !== 'live')
      .sort((a, b) => b.t - a.t);
  },
  clearProgress() { write(K.prog, {}); }
};

// ---------------- IndexedDB (cache da lista, que pode ser enorme) ----------------
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('turboflix', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}
export async function idbGet(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const q = d.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  } catch { return null; }
}
export async function idbSet(key, val) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) { console.warn('idb', e); }
}
export async function idbClear() {
  try {
    const d = await db();
    await new Promise((res) => { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').clear(); tx.oncomplete = res; tx.onerror = res; });
  } catch { /* ignore */ }
}
