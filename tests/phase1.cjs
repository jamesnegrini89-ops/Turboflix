// Testes da fase 1 em Chromium, sem credenciais ou servidor IPTV real.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8000';

function checkFilters(){
  const source=fs.readFileSync('js/browse-filters.js','utf8').replace(/^export /gm,'');
  const {filterCatalog,releaseYear,availableYears}=new Function(source+
    '\nreturn {filterCatalog,releaseYear,availableYears};')();
  const items=[
    {id:'a',name:'Ação (2025)',group:'Ação',added:200},
    {id:'b',name:'Zebra (2026)',group:'Drama',added:400},
    {id:'c',name:'Épico (2026)',group:'Ação',added:500}
  ];
  assert.equal(releaseYear({name:'Filme (2026)'}),2026);
  assert.equal(releaseYear({name:'Canal 2026'}),null);
  assert.deepEqual(availableYears(items),[2026,2025]);
  assert.deepEqual(filterCatalog(items,{group:'Ação',year:'2026'}).map(i=>i.id),['c']);
  assert.deepEqual(filterCatalog(items,{favorites:true},id=>id==='a').map(i=>i.id),['a']);
  assert.deepEqual(filterCatalog(items,{sort:'recent'}).map(i=>i.id),['c','b','a']);
  console.log('PASS: filtros unitários (gênero, ano, recentes, favoritos)');
}

(async()=>{
  checkFilters();
  const browser=await chromium.launch({
    executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
    args:['--no-sandbox']
  });
  try{
    const ctx=await browser.newContext({viewport:{width:1280,height:840},serviceWorkers:'block'});
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const data={
      get_live_categories:[{category_id:'1',category_name:'Canais'}],
      get_vod_categories:[
        {category_id:'1',category_name:'Ação'},
        {category_id:'2',category_name:'Drama'}
      ],
      get_series_categories:[{category_id:'1',category_name:'Séries'}],
      get_live_streams:Array.from({length:18},(_,i)=>({
        stream_id:i+1,name:'Canal '+(i+1),category_id:'1'
      })),
      get_vod_streams:Array.from({length:260},(_,i)=>({
        stream_id:i+1,name:'Filme '+String(i+1).padStart(3,'0')+
          (i%3===0?' (2025)':' (2026)'),
        category_id:i%2===0?'1':'2',added:500+i
      })),
      get_series:Array.from({length:6},(_,i)=>({
        series_id:i+1,name:'Série '+(i+1)+' (2026)',category_id:'1'
      }))
    };
    await page.route('**/player_api.php?**',async route=>{
      const action=new URL(route.request().url()).searchParams.get('action');
      await route.fulfill({json:data[action]||{user_info:{auth:1,status:'Active'},server_info:{}}});
    });
    await page.goto(base);
    await page.locator('#m3u-url').fill(base+'/get.php?username=fixture&password=fixture&output=ts');
    await page.locator('[data-act="login"]').click();
    await page.waitForURL('**/#/home');
    assert.equal(await page.locator('#mobile-nav').isVisible(),false);
    assert.equal(await page.locator('#mainnav').isVisible(),true);
    await page.locator('.hub[data-key="movies"]').click();
    await page.locator('#grid .card').first().waitFor();
    await page.locator('[data-browse-filter="group"]').selectOption('Ação');
    await page.locator('[data-browse-filter="year"]').selectOption('2026');
    assert.equal(await page.locator('#grid .card').count(),86);
    await page.locator('[data-browse-filter="sort"]').selectOption('az');
    const first=await page.locator('#grid .card').first().getAttribute('data-id');
    assert.equal(first,'m3');
    const cardCount=await page.locator('.card-wrap').count();
    assert.ok(cardCount>0);
    assert.equal(await page.locator('.card-wrap').first().locator('button').count(),2);
    await page.locator('.card-quickfav').first().click();
    assert.match(page.url(),/#\/browse\/movies$/);
    assert.equal(await page.locator('.card-quickfav').first().getAttribute('aria-pressed'),'true');
    await page.locator('[data-act="favonly"]').click();
    assert.equal(await page.locator('#grid .card').count(),1);
    await page.locator('#grid .card-quickfav').first().click();
    assert.equal(await page.locator('#grid .card').count(),0);
    await page.locator('[data-act="favonly"]').click();
    await page.locator('[data-browse-filter="group"]').selectOption('*');
    await page.locator('[data-browse-filter="year"]').selectOption('*');
    await page.locator('[data-browse-filter="sort"]').selectOption('default');
    await page.locator('#grid .card').nth(55).scrollIntoViewIfNeeded();
    const before=await page.evaluate(()=>document.querySelector('.browse-main').scrollTop);
    assert.ok(before>0,'A grade deve permitir rolagem antes do retorno');
    await page.locator('#grid .card').nth(55).click();
    await page.waitForURL('**/#/movie/**');
    await page.goBack();
    await page.waitForURL('**/#/browse/movies');
    await page.waitForTimeout(250);
    const after=await page.evaluate(()=>document.querySelector('.browse-main').scrollTop);
    assert.ok(after>0,'O retorno deve preservar rolagem interna: antes='+before+', depois='+after);
    assert.equal(await page.locator('[data-browse-filter="group"]').inputValue(),'*');
    console.log('PASS: desktop, filtros combinados, favorito de um toque e retorno ao catálogo');

    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#mobile-nav').isVisible(),true);
    assert.equal(await page.locator('#mainnav').isVisible(),false);
    await page.locator('#mobile-nav [data-route="#/search"]').click();
    await page.waitForURL('**/#/search');
    assert.equal(await page.locator('#q').isVisible(),true);
    assert.equal(await page.locator('#mobile-nav [data-route="#/search"]').getAttribute('aria-current'),'page');
    await page.locator('#mobile-nav [data-route="#/home"]').click();
    await page.locator('.hub[data-key="movies"]').click();
    await page.locator('#grid .card').nth(35).scrollIntoViewIfNeeded();
    const beforeMobile=await page.evaluate(()=>scrollY);
    assert.ok(beforeMobile>0,'Catálogo mobile deve rolar');
    await page.locator('#grid .card').nth(35).click();
    await page.waitForURL('**/#/movie/**');
    await page.goBack();
    await page.waitForURL('**/#/browse/movies');
    await page.waitForTimeout(250);
    const afterMobile=await page.evaluate(()=>scrollY);
    assert.ok(afterMobile>0,'Voltar do detalhe deve preservar rolagem mobile: antes='+beforeMobile+', depois='+afterMobile);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    console.log('PASS: barra inferior e posição anterior no celular (390px)');
    assert.deepEqual(errors,[],'Sem exceções JavaScript no Chromium');
    console.log('PASS: ausência de exceções JS');
    await ctx.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
