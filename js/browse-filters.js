// Filtros puros do catálogo. Atributos inexistentes não são inventados.
// Não depende da rede, do player nem das credenciais IPTV.
export function releaseYear(item) {
  const raw = String(item?.year || item?.releaseDate || item?.release_date || '');
  const explicit = raw.match(/\b(19\d{2}|20\d{2})\b/);
  if (explicit) return Number(explicit[1]);
  const name = String(item?.name || '');
  // Só interpreta ano no título se estiver entre parênteses.
  const fromName = name.match(/\((19\d{2}|20\d{2})\)/);
  return fromName ? Number(fromName[1]) : null;
}

export function availableYears(items) {
  const years = new Set();
  for (const item of items) {
    const y = releaseYear(item);
    if (y) years.add(y);
  }
  return [...years].sort((a,b) => b - a);
}

export function filterCatalog(items, opts = {}, isFavorite = () => false) {
  const group = opts.group || '*';
  const year = opts.year || '*';
  const fav = Boolean(opts.favorites || group === '@fav');
  let out = items.filter(item => {
    if (group !== '*' && group !== '@fav' && item.group !== group) return false;
    if (fav && !isFavorite(item.id)) return false;
    if (year !== '*' && releaseYear(item) !== Number(year)) return false;
    return true;
  });
  if (opts.sort === 'az' || opts.sort === 'za') {
    const sign = opts.sort === 'az' ? 1 : -1;
    out.sort((a,b) => sign * String(a.name||'').localeCompare(String(b.name||''),'pt-BR',{sensitivity:'base',numeric:true}));
  } else if (opts.sort === 'recent') {
    // A data de inclusão é opcional e não deve ser confundida com o ano de lançamento.
    out.sort((a,b) => (Number(b.added)||0) - (Number(a.added)||0));
  }
  return out;
}
