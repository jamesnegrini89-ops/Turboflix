// Checagem explícita da versão web, sem apagar dados locais ou alterar o APK.
export function compareVersions(a,b) {
  const parse=s=>{
    const value=String(s||'').trim();
    if(!/^\d+\.\d+\.\d+$/.test(value))throw new Error('Versão inválida.');
    return value.split('.').map(Number);
  };
  const x=parse(a),y=parse(b);
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;
  return 0;
}
export async function fetchLatestVersion() {
  const url=new URL('version.json',document.baseURI);
  url.searchParams.set('check',String(Date.now()));
  const res=await fetch(url.toString(),{cache:'no-store',headers:{Accept:'application/json'}});
  if(!res.ok)throw new Error('Não foi possível consultar a versão publicada.');
  const json=await res.json();
  if(!json||typeof json.version!=='string'||!/^\d+\.\d+\.\d+$/.test(json.version))
    throw new Error('Informação de versão inválida.');
  return json.version;
}
export function updatePageURL(version) {
  if(!/^\d+\.\d+\.\d+$/.test(String(version)))throw new Error('Versão inválida.');
  const url=new URL(location.href);
  url.searchParams.set('v',version);
  return url.href;
}
export async function applyWebUpdate(version) {
  if(!navigator.onLine)throw new Error('Conecte-se à internet para atualizar.');
  if('serviceWorker' in navigator) {
    const registration=await navigator.serviceWorker.getRegistration();
    if(registration)await registration.update();
  }
  // O URL com query diferente do shell em cache força novo HTML online.
  location.replace(updatePageURL(version));
}
