const pending = new Map();
let nextId = 0;
window.addEventListener('turboflix:native-result', ({ detail }) => {
  const request = pending.get(detail?.id);
  if (!request) return;
  pending.delete(detail.id);
  clearTimeout(request.timer);
  if (detail.error) request.reject(new Error(detail.value));
  else request.resolve(detail.value);
});
export const hasNativeDlna = () => typeof window.AndroidDlna?.request === 'function';
export function nativeRequest(action, args = {}) {
  return new Promise((resolve, reject) => {
    if (!hasNativeDlna()) { reject(new Error('DLNA nativo indisponível')); return; }
    const id = String(++nextId);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Tempo esgotado. Aguarde e tente novamente.'));
    }, 25000);
    pending.set(id, { resolve, reject, timer });
    try { window.AndroidDlna.request(id, action, JSON.stringify(args)); }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}
