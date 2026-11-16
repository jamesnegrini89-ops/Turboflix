// Ferramentas de busca do TurboFlix: sem chamadas externas.
const TYPES=['movie','series','live'];

export function recentSearches(value) {
  if (!Array.isArray(value)) return [];
  const seen=new Set(),out=[];
  for(const entry of value) {
    if(typeof entry!=='string')continue;
    const q=entry.trim().replace(/\s+/g,' ').slice(0,80);
    const key=q.toLocaleLowerCase('pt-BR');
    if(q.length<2||seen.has(key))continue;
    seen.add(key);out.push(q);
    if(out.length===8)break;
  }
  return out;
}

export function rememberSearch(value,query) {
  if(typeof query!=='string')return recentSearches(value);
  const cleaned=query.trim().replace(/\s+/g,' ').slice(0,80);
  if(cleaned.length<2)return recentSearches(value);
  return recentSearches([cleaned,...recentSearches(value)]);
}

function relevance(name,term,words) {
  if(name===term)return 0;
  if(name.startsWith(term))return 1;
  if(name.split(/\W+/u).some(w=>w.startsWith(term)))return 2;
  if(words.some(w=>name.includes(w)))return 3;
  return 4;
}

export function findCatalogMatches(index, query, type='all', maxPerType=120, maxSuggestions=6) {
  const q=String(query||'').trim();
  const empty={movie:[],series:[],live:[],suggestions:[]};
  if(q.length<2)return empty;
  const words=q.split(/\s+/).filter(Boolean);
  const best=[];
  const seen=new Set();
  for(const entry of index) {
    if(!Array.isArray(entry)||entry.length<2)continue;
    const [name,item]=entry;
    if(!item||!TYPES.includes(item.type))continue;
    if(type!=='all'&&type!==item.type)continue;
    if(!words.every(w=>name.includes(w)))continue;
    const bucket=empty[item.type];
    if(bucket.length<maxPerType)bucket.push(item);
    if(!seen.has(item.id)) {
      seen.add(item.id);
      const score=relevance(name,q,words),length=name.length;
      const candidate={item,score,length};
      best.push(candidate);
      best.sort((a,b)=>a.score-b.score||a.length-b.length);
      if(best.length>maxSuggestions)best.length=maxSuggestions;
    }
  }
  empty.suggestions=best.map(c=>c.item);
  return empty;
}
