// Fase 3: grade virtual de 50 mil itens e atualizações web sem alterar dados.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8000';

function unitChecks(){
  const winCode=fs.readFileSync('js/catalog-window.js','utf8').replace(/^export /gm,'');
  const {windowBounds,VIRTUAL_THRESHOLD,MAX_VISIBLE}=new Function(winCode+
    '\nreturn {windowBounds,VIRTUAL_THRESHOLD,MAX_VISIBLE};')();
  assert.equal(VIRTUAL_THRESHOLD,1500);
  for(const [total,cols,row] of [[50000,6,0],[50000,6,4600],[50000,6,8330]]){
    const w=windowBounds(total,cols,row,8);
    assert.ok(w.start>=0&&w.end<=total&&w.end-w.start<=MAX_VISIBLE);
    assert.equal(w.start%cols,0);
  }
  const updates=fs.readFileSync('js/update-ui.js','utf8').replace(/^export /gm,'');
  const {compareVersions}=new Function(updates+'\nreturn {compareVersions};')();
  assert.equal(compareVersions('1.11.1','1.10.9'),1);
  assert.equal(compareVersions('1.9.9','1.10.0'),-1);
  assert.equal(compareVersions('1.11.1','1.11.1'),0);
  console.log('PASS: limites da grade e comparação de versões');
}

(async()=>{
  unitChecks();
  const browser=await chromium.launch({
    executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
    args:['--no-sandbox']
  });
  try{
    const ctx=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
    const p=await ctx.newPage();
    const errors=[];
    p.on('pageerror',e=>errors.push(e.message));
    const mock={
      get_live_categories:[{category_id:'1',category_name:'TV'}],
      get_vod_categories:[{category_id:'1',category_name:'Filmes'}],
      get_series_categories:[{category_id:'1',category_name:'Séries'}],
      get_live_streams:[],
      get_vod_streams:Array.from({length:50000},(_,i)=>({
        stream_id:i+1,name:'Filme '+(i+1),added:i+1,category_id:'1'
      })),
      get_series:[]
    };
    await p.route('**/player_api.php?**',async route=>{
      const action=new URL(route.request().url()).searchParams.get('action');
      await route.fulfill({json:mock[action]||{user_info:{auth:1,status:'Active'},server_info:{}}});
    });
    await p.route('**/version.json?**',route=>route.fulfill({json:{version:'1.12.0'}}));
    await p.goto(base);
    await p.locator('#m3u-url').fill(base+'/get.php?username=fixture&password=fixture&output=ts');
    await p.locator('[data-act="login"]').click();
    await p.waitForURL('**/#/home');
    await p.locator('.hub[data-key="movies"]').click();
    const grid=p.locator('#grid.virtualized');
    await grid.waitFor({state:'visible'});
    let state=await grid.evaluate(el=>el._virtualDebug());
    assert.equal(state.count,50000);
    assert.ok(state.domCards>0 && state.domCards<=216,state);
    console.log('PASS: 50.000 itens com no máximo 216 cartões no DOM');

    await p.evaluate(()=>{
      const el=document.querySelector('.browse-main');
      el.scrollTop=(el.scrollHeight-el.clientHeight)*0.62;
      el.dispatchEvent(new Event('scroll'));
    });
    await p.waitForFunction(()=>{
      const grid=document.querySelector('#grid');
      return grid?._virtualDebug?.().start>10000;
    },null,{timeout:15000});
    state=await grid.evaluate(el=>el._virtualDebug());
    assert.ok(state.start>10000 && state.domCards<=216,state);
    const anchor=await grid.locator('.card').first().getAttribute('data-vi');
    assert.ok(Number(anchor)>=state.start);
    const maxHeight=await p.evaluate(()=>document.querySelector('.browse-main').scrollHeight);
    assert.ok(maxHeight>500000,'A grade deve preservar a posição do catálogo completo');
    console.log('PASS: rolagem profunda, altura virtual e DOM limitado');

    await p.evaluate(()=>{
      const el=document.querySelector('.browse-main');
      el.scrollTop=0;el.dispatchEvent(new Event('scroll'));
    });
    await p.waitForFunction(()=>document.querySelector('#grid')?._virtualDebug?.().start===0);
    assert.equal(await p.locator('#grid .card').first().getAttribute('data-id'),'m1');
    await p.locator('#grid .card').first().focus();
    await p.keyboard.press('ArrowDown');
    const moved=await p.evaluate(()=>document.activeElement?.dataset?.id);
    assert.notEqual(moved,'m1');
    console.log('PASS: retorno ao início e navegação por teclado');

    // Atualizações não precisam ler ou eliminar credenciais e preferências.
    await p.locator('#mainnav [data-route="#/settings"]').click();
    await p.locator('[data-act="checkupdate"]').waitFor({state:'visible'});
    const before=await p.evaluate(()=>({
      cfg:localStorage.getItem('tf_cfg'),
      fav:localStorage.getItem('tf_favorites'),
      prog:localStorage.getItem('tf_progress')
    }));
    await p.locator('[data-act="checkupdate"]').click();
    await p.waitForFunction(()=>document.querySelector('#update-status')?.textContent?.includes('1.12.0'));
    assert.equal(await p.locator('#apply-update').isVisible(),true);
    const after=await p.evaluate(()=>({
      cfg:localStorage.getItem('tf_cfg'),
      fav:localStorage.getItem('tf_favorites'),
      prog:localStorage.getItem('tf_progress')
    }));
    assert.deepEqual(after,before);
    console.log('PASS: checagem online informa nova versão e preserva dados locais');

    await p.setViewportSize({width:390,height:844});
    await p.locator('#mobile-nav [data-route="#/home"]').click();
    await p.locator('.hub[data-key="movies"]').click();
    await grid.waitFor({state:'visible'});
    await p.evaluate(()=>{
      scrollTo(0,document.documentElement.scrollHeight*0.48);
      window.dispatchEvent(new Event('scroll'));
    });
    await p.waitForFunction(()=>document.querySelector('#grid')?._virtualDebug?.().start>1000,null,{timeout:15000});
    state=await grid.evaluate(el=>el._virtualDebug());
    assert.ok(state.domCards<=216,state);
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);
    console.log('PASS: catálogo virtualizado no celular sem rolagem horizontal nem exceções JS');
    await ctx.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
