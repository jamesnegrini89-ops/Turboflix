// Destaques da página inicial: usar imagens válidas do catálogo do usuário.
// Não consulta serviços externos de metadados nem expõe credenciais.
import { imageCandidates } from './net.js?v=1.8.11';

const approvedByCategory = new Map();
const MAX_SOURCE_CANDIDATES = 18;

export function resetHubArtworkCache() { approvedByCategory.clear(); }

export function selectHubArtwork(items) {
  const candidates = items.filter(item =>
    item && typeof item.logo === 'string' && /^https?:\/\//i.test(item.logo.trim()));
  if (!candidates.length) return [];
  // Prioriza a data de inclusão, quando fornecida pela lista Xtream.
  const sorted = candidates.some(item => Number(item.added) > 0)
    ? [...candidates].sort((a,b) => (Number(b.added) || 0) - (Number(a.added) || 0))
    : candidates;
  const picked = sorted.slice(0,12);
  if (sorted.length > 12) {
    for (const frac of [0.20,0.40,0.60,0.80,0.98,0.08]) {
      picked.push(sorted[Math.floor((sorted.length-1)*frac)]);
    }
  }
  return [...new Set(picked.map(item => item?.logo?.trim()).filter(Boolean))]
    .slice(0,MAX_SOURCE_CANDIDATES);
}

function checkImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const finish = valid => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(valid);
    };
    const timer = setTimeout(() => finish(false), 4000);
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

async function firstWorkingImage(raw) {
  for (const target of imageCandidates(raw).slice(0,2)) {
    // O GitHub Pages e a WebView usam HTTPS.
    if (!/^https:\/\//i.test(target)) continue;
    if (await checkImage(target)) return target;
  }
  throw new Error('Imagem indisponível');
}

async function paintCategory(element, category, items, view) {
  if (!element || !element.isConnected || !items.length) return;
  const already = approvedByCategory.get(category);
  if (already) {
    element.style.backgroundImage = 'url(' + JSON.stringify(already) + ')';
    return;
  }
  const sources = selectHubArtwork(items);
  // Três tentativas paralelas para não atrasar a página quando uma URL falha.
  for (let i = 0; i < sources.length; i += 3) {
    if (!element.isConnected || view.dataset.view !== 'home') return;
    const working = await Promise.any(
      sources.slice(i,i+3).map(firstWorkingImage)
    ).catch(() => null);
    if (!working) continue;
    approvedByCategory.set(category,working);
    if (element.isConnected && view.dataset.view === 'home')
      element.style.backgroundImage = 'url(' + JSON.stringify(working) + ')';
    return;
  }
}

export function paintHomeCategories(hubs,view) {
  const elems=[...view.querySelectorAll('.hub-bg[data-hub]')];
  for (const entry of hubs) {
    const el=elems.find(e=>e.dataset.hub === entry.h.key);
    if (el) void paintCategory(el,entry.h.key,entry.items,view);
  }
}
