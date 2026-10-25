// Run with Node and Playwright available; see tests/README.md.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8000';
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 try {
 const context = await browser.newContext({serviceWorkers:'block'});
 const page = await context.newPage(); const errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 const data = {
 get_live_categories:[{category_id:'1',category_name:'TV'}],
 get_vod_categories:[{category_id:'1',category_name:'Filmes'}],
 get_series_categories:[{category_id:'1',category_name:'Séries'}],
 get_live_streams:Array.from({length:3000},(_,i)=>({stream_id:i+1,name:`Canal ${i+1}`,category_id:'1'})),
 get_vod_streams:Array.from({length:37000},(_,i)=>({stream_id:i+1,name:`Filme Ação ${i+1}`,category_id:'1',added:i})),
 get_series:Array.from({length:10000},(_,i)=>({series_id:i+1,name:`Série ${i+1}`,category_id:'1'}))
 };
 let releaseSeries; let seriesRequested;
 const requested = new Promise(r=>seriesRequested=r);
 await page.route('**/player_api.php?**',async route=>{
 const action=new URL(route.request().url()).searchParams.get('action');
 if(action==='get_series_info'){seriesRequested();await new Promise(r=>releaseSeries=r);return route.fulfill({json:{info:{plot:'Resposta antiga'},episodes:{}}});}
 await route.fulfill({json:data[action] || {user_info:{auth:1,status:'Active'},server_info:{}}});
 });
 await page.goto(base);
 await page.locator('#m3u-url').fill(`${base}/get.php?username=fixture&password=fixture&output=ts`);
 await page.locator('[data-act="login"]').click();
 await page.waitForURL('**/#/home');
 assert.match(await page.locator('#view').innerText(),/37.000/);
 console.log('PASS: catálogo de 50.000 itens');
 await page.locator('[data-key="movies"]').click();
 await page.locator('#grid .card').first().waitFor();
 assert.ok(await page.locator('#grid .card').count()<500);
 await page.locator('#grid .card').first().focus();
 const perf=await page.evaluate(async()=>{
 const {moveFocus}=await import('./js/nav.js');
 let reads=0;const original=Element.prototype.getBoundingClientRect;
 Element.prototype.getBoundingClientRect=function(){reads++;return original.call(this)};
 const start=performance.now();for(let i=0;i<40;i++)moveFocus('down');
 Element.prototype.getBoundingClientRect=original;
 return {ms:performance.now()-start,reads,id:document.activeElement.dataset.id};
 });
 assert.ok(perf.reads<600,JSON.stringify(perf));assert.notEqual(perf.id,'m1');
 console.log('PASS: navegação e carregamento incremental',perf);
 await page.locator('[data-route="#/search"]').click();
 await page.locator('#q').fill('acao 999');await page.locator('#q').press('Enter');
 await page.locator('#results .card').first().waitFor();
 const focused=await page.evaluate(()=>document.activeElement.dataset.id);
 await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.id),focused);
 assert.match(await page.locator('#results').innerText(),/Ação 999/);
 console.log('PASS: busca sem acentos e foco preservado após Enter');
 await page.evaluate(()=>location.hash='#/series/s1');await requested;
 await page.locator('[data-route="#/settings"]').click();releaseSeries();
 await page.waitForTimeout(300);assert.equal(await page.locator('#view').getAttribute('data-view'),'settings');
 await page.locator('[data-v="m3u8"]').click();
 assert.ok(await page.evaluate(async()=>{const {xtreamUrls}=await import('./js/xtream.js');return xtreamUrls({server:location.origin,user:'fixture',pass:'fixture',preferredOutput:'ts'},{sid:1,type:'live'})[0].endsWith('.m3u8')}));
 console.log('PASS: resposta tardia de série e preferência HLS');
 await page.setViewportSize({width:360,height:780});
 await page.locator('[data-route="#/search"]').click();await page.locator('#q').fill('Canal');
 await page.locator('#results .card').first().waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

 await page.evaluate(()=>location.hash='#/browse/movies');
 await page.locator('.grp').first().focus();await page.keyboard.press('ArrowRight');
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.g),'Filmes');
 await page.keyboard.press('ArrowDown');
 assert.ok(await page.evaluate(()=>document.activeElement.classList.contains('card')));
 assert.deepEqual(errors,[]);
 console.log('PASS: layout 360px e ausência de erros JavaScript');
 await context.close();
 const offline=await browser.newContext();const p=await offline.newPage();
 await p.goto(base);await p.evaluate(()=>navigator.serviceWorker.ready);
 await p.reload();
 await p.evaluate(async()=>{await caches.open('unrelated-app');await fetch('/README.md?private=fixture')});
 const cached=await p.evaluate(async()=>{const c=await caches.open('turboflix-v1.8.5');return (await c.keys()).map(r=>r.url)});
 assert.ok(cached.some(u=>u.endsWith('icon-maskable-512.png')));
 assert.ok(!cached.some(u=>u.includes('private=')));
 await offline.setOffline(true);await p.reload();await p.locator('#m3u-url').waitFor();
 console.log('PASS: PWA offline, ícone adaptável e exclusão de respostas privadas do cache');
 await offline.close();
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
