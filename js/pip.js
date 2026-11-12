// Picture-in-Picture e controles de mídia do TurboFlix.
// A mini-janela é gerenciada pelo navegador/Android: dimensões, posição e gesto de pinça
// não podem ser controlados pelo JavaScript do aplicativo.
export function initPictureInPicture({ video, button, getItem, onNext, onPrevious, onSeek }) {
  const media = ('mediaSession' in navigator) ? navigator.mediaSession : null;
  let lastPositionUpdate = 0;

  const current = () => getItem();
  const available = () => Boolean(document.pictureInPictureEnabled &&
    typeof video.requestPictureInPicture === 'function' && !video.disablePictureInPicture);
  const isOpen = () => document.pictureInPictureElement === video;

  function notify(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function syncButton() {
    if (!button) return;
    button.hidden = !available();
    button.setAttribute('aria-pressed', String(isOpen()));
    const title = isOpen() ? 'Fechar tela flutuante' : 'Abrir tela flutuante';
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  function syncPlayback() {
    if (!media) return;
    try { media.playbackState = !current() ? 'none' : (video.paused ? 'paused' : 'playing'); } catch {}
  }

  function syncPosition(force = false) {
    if (!media || typeof media.setPositionState !== 'function') return;
    const item = current();
    if (!item || item.type === 'live') return;
    const now = Date.now();
    if (!force && now - lastPositionUpdate < 3000) return;
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const position = Number.isFinite(video.currentTime)
      ? Math.max(0, Math.min(duration, video.currentTime)) : 0;
    try {
      media.setPositionState({
        duration,
        position,
        playbackRate: Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1
      });
      lastPositionUpdate = now;
    } catch {}
  }

  function updateItem() {
    const item = current();
    if (media) {
      try {
        media.metadata = item && typeof MediaMetadata === 'function'
          ? new MediaMetadata({
              title: item.name || 'TurboFlix',
              artist: item.seriesName || item.group || 'TurboFlix',
              album: 'TurboFlix'
            })
          : null;
      } catch {}
    }
    lastPositionUpdate = 0;
    syncPlayback();
    syncButton();
  }

  async function enter(silent = false) {
    if (!current() || !available()) {
      if (!silent) notify('Tela flutuante indisponível neste navegador ou aplicativo.');
      return false;
    }
    if (isOpen()) return true;
    if (video.readyState < 2 || !video.videoWidth) {
      if (!silent) notify('Aguarde o vídeo começar para abrir a tela flutuante.');
      return false;
    }
    try {
      await video.requestPictureInPicture();
      syncButton();
      return true;
    } catch {
      if (!silent) notify('O sistema bloqueou a tela flutuante. Verifique as permissões do aplicativo.');
      return false;
    }
  }

  async function toggle() {
    if (!isOpen()) return enter(false);
    try {
      await document.exitPictureInPicture();
      syncButton();
      return true;
    } catch {
      notify('Não foi possível fechar a tela flutuante.');
      return false;
    }
  }

  function setAction(name, handler) {
    if (!media) return;
    try { media.setActionHandler(name, handler); } catch {}
  }

  setAction('play', () => { if (current()) video.play().catch(() => {}); });
  setAction('pause', () => { if (current()) video.pause(); });
  setAction('stop', () => {
    if (!current()) return;
    video.pause();
    if (isOpen()) document.exitPictureInPicture().catch(() => {});
  });
  setAction('seekbackward', (details) => { if (current()) onSeek(-(details.seekOffset || 10)); });
  setAction('seekforward', (details) => { if (current()) onSeek(details.seekOffset || 10); });
  setAction('seekto', (details) => {
    if (!current() || current().type === 'live') return;
    if (Number.isFinite(details.seekTime) && Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.max(0, Math.min(video.duration, details.seekTime));
    }
  });
  setAction('nexttrack', () => { if (current()) onNext(); });
  setAction('previoustrack', () => { if (current()) onPrevious(); });
  // O Chrome pode solicitar PiP ao trocar de aplicativo/aba quando suas regras permitirem.
  if (available()) setAction('enterpictureinpicture', () => { void enter(true); });

  video.addEventListener('enterpictureinpicture', syncButton);
  video.addEventListener('leavepictureinpicture', syncButton);
  video.addEventListener('play', syncPlayback);
  video.addEventListener('playing', syncPlayback);
  video.addEventListener('pause', syncPlayback);
  video.addEventListener('loadedmetadata', () => syncPosition(true));
  video.addEventListener('durationchange', () => syncPosition(true));
  video.addEventListener('seeked', () => syncPosition(true));
  video.addEventListener('ratechange', () => syncPosition(true));
  video.addEventListener('timeupdate', () => syncPosition(false));

  document.addEventListener('visibilitychange', () => {
    // Tentativa não intrusiva. Muitos navegadores exigem interação explícita
    // e rejeitam a chamada após minimizar; o botão PiP permanece a opção confiável.
    if (document.hidden && current() && !video.paused && !isOpen()) void enter(true);
  });

  syncButton();

  function clear() {
    if (isOpen()) document.exitPictureInPicture().catch(() => {});
    if (media) {
      try { media.metadata = null; media.playbackState = 'none'; } catch {}
    }
    syncButton();
  }

  return { toggle, updateItem, clear };
}
