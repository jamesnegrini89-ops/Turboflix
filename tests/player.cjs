// Smoke test do player nativo em Chromium. WebM/VP8 é suportado no Chromium
// de CI sem depender de codecs proprietários H.264.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'turboflix-test-'));
const media = path.join(tmp, 'fixture.webm');
execFileSync('ffmpeg', [
  '-hide_banner','-loglevel','error','-f','lavfi',
  '-i','testsrc2=size=320x180:rate=24',
  '-t','12','-c:v','libvpx','-b:v','450k','-pix_fmt','yuv420p',media
]);

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  try {
    const c = await b.newContext({ serviceWorkers: 'block' });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    const bytes = fs.readFileSync(media);
    await p.route('**/fixture.webm', r => {
      const match = /^bytes=(\d+)-(\d*)$/.exec(r.request().headers().range || '');
      if (match) {
        const start = Math.min(bytes.length - 1, Number(match[1]));
        const end = match[2] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1;
        return r.fulfill({
          status: 206,
          contentType: 'video/webm',
          headers: {
            'Content-Range': 'bytes ' + start + '-' + end + '/' + bytes.length,
            'Accept-Ranges': 'bytes'
          },
          body: bytes.subarray(start, end + 1)
        });
      }
      return r.fulfill({ contentType: 'video/webm', body: bytes });
    });
    await p.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:8000');
    await p.locator('#m3u-url').waitFor();
    const open = async number => {
      await p.evaluate(async n => {
        const { Player } = await import('./js/player.js?v=1.11.1');
        Player.open({
          id: 'test' + n, type: 'movie', name: 'Test ' + n,
          url: location.origin + '/fixture.webm'
        });
      }, number);
    };
    const checkPlaying = async () => {
      try {
        await p.waitForFunction(() => document.querySelector('#video').currentTime > 1,
          null, { timeout: 15000 });
      } catch {
        const state = await p.evaluate(() => {
          const v = document.querySelector('#video');
          const error = document.querySelector('#p-error');
          return {
            src: v.currentSrc,
            currentTime: v.currentTime,
            readyState: v.readyState,
            paused: v.paused,
            error: v.error?.code || null,
            playerErrorVisible: !error.hidden,
            playerErrorText: error.textContent?.slice(0,200) || ''
          };
        });
        throw new Error('Fixture not playing: ' + JSON.stringify(state));
      }
    };
    await open(1);
    await checkPlaying();
    console.log('PASS: native WebM/VP8 playback in Chromium');

    // O botão deve utilizar a Activity Android quando o novo APK tem a ponte
    // NativePip. Os sinais são simulados, sem exigir um telefone no CI.
    await p.evaluate(() => {
      window.__fsCalls = [];
      window.NativePip = {
        fullscreen(enabled) {
          window.__fsCalls.push(enabled);
          document.documentElement.classList.toggle('tf-native-fullscreen', enabled);
        }
      };
    });
    const fsBtn = p.locator('#player [data-p="fs"]');
    await fsBtn.click({force:true});
    await fsBtn.click({force:true});
    assert.deepEqual(await p.evaluate(() => window.__fsCalls), [true,false]);
    console.log('PASS: botão de tela cheia ativa/desativa ponte nativa Android');

    // Um APK antigo pode disponibilizar AndroidDlna sem NativePip. A
    // presença dessa interface não deve bloquear a Fullscreen API da Web.
    await p.evaluate(() => {
      delete window.NativePip;
      window.AndroidDlna = {};
      window.__browserFullscreenCalls = 0;
      const root = document.getElementById('player');
      Object.defineProperty(root, 'requestFullscreen', {
        configurable:true,
        value: () => {
          window.__browserFullscreenCalls++;
          return Promise.resolve();
        }
      });
    });
    await fsBtn.click({force:true});
    assert.equal(await p.evaluate(() => window.__browserFullscreenCalls), 1);
    console.log('PASS: APK com AndroidDlna não bloqueia botão de tela cheia');

    // O encerramento do player restaura o modo anterior da Activity.
    await p.evaluate(() => {
      window.NativePip = {
        fullscreen(enabled) {
          window.__fsCalls.push(enabled);
          document.documentElement.classList.toggle('tf-native-fullscreen', enabled);
        }
      };
      document.documentElement.classList.add('tf-native-fullscreen');
    });

    await p.evaluate(async () => {
      const { Player } = await import('./js/player.js?v=1.11.1');
      for (let i = 2; i <= 8; i++) {
        Player.open({ id: 'test' + i, type: 'movie', name: 'Test ' + i,
          url: location.origin + '/fixture.webm' });
      }
    });
    await checkPlaying();
    assert.equal(await p.locator('#p-title').innerText(), 'Test 8');
    console.log('PASS: rapid replacement keeps last item active');
    await p.evaluate(async () => {
      const { Player } = await import('./js/player.js?v=1.11.1');
      Player.close();
    });
    await p.waitForTimeout(500);
    assert.ok(await p.locator('#video').evaluate(v => v.paused && !v.getAttribute('src')));
    assert.equal(await p.evaluate(() => window.__fsCalls.at(-1)), false);
    console.log('PASS: fechar player sai do modo de tela cheia nativa');
    assert.deepEqual(errors, []);
    console.log('PASS: closing player releases video and no JS crashes');
    await c.close();
  } finally {
    await b.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
