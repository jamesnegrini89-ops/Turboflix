// Regressão da fase 2: catálogo fictício, nenhum login ou IPTV real.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8000';

function unitSearch() {
  const text=fs.readFileSync('js/search-ui.js','utf8').replace(/^export /gm,'');
  const {recentSearches,rememberSearch,findCatalogMatches}=
    new Function(text+';return {recentSearches,rememberSearch,findCatalogMatches};')();
  assert.deepEqual(rememberSearch(['Filmes','Séries'],'filmes'),['filmes','Séries']);
  assert.deepEqual(recentSearches(['A','',false,'Série','Série']),['Série']);
  const index=[
    ['filme 12',{id:'m12',type:'movie',name:'Filme 12'}],
    ['canal filme',{id:'l7',type:'live',name:'Canal Filme'}],
    ['filme 1',{id:'m1',type:'movie',name:'Filme 1'}]
  ];
  assert.deepEqual(findCatalogMatches(index,'filme','movie').movie.map(i=>i.id),['m12','m1']);
  assert.equal(findCatalogMatches(index,'filme','live').suggestions[0].type,'live');
  console.log('PASS: função de busca, sugestões por tipo e histórico local');
}

(async()=>{
  unitSearch();
  const b=await chromium.launch({
    executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',
    args:['--no-sandbox']
  });
  try{
    const ctx=await b.newContext({viewport:{width:1180,height:820},serviceWorkers:'block'});
    const p=await ctx.newPage(),errors=[];
    p.on('pageerror',e=>errors.push(e.message));
    const fixture={
      get_live_categories:[{category_id:'1',category_name:'Esportes'}],
      get_vod_categories:[
        {category_id:'1',category_name:'Ação'},
        {category_id:'2',category_name:'NETFLIX Filmes'}
      ],
      get_series_categories:[{category_id:'1',category_name:'Séries'}],
      get_live_streams:Array.from({length:28},(_,i)=>({
        stream_id:i+1,name:'Canal '+(i+1),category_id:'1'
      })),
      get_vod_streams:Array.from({length:300},(_,i)=>({
        stream_id:i+1,name:'Filme '+(i+1)+' (2026)',
        category_id:i%3===0?'2':'1',added:i+1
      })),
      get_series:Array.from({length:20},(_,i)=>({
        series_id:i+1,name:'Série '+(i+1)+' (2026)',category_id:'1'
      }))
    };
    await p.route('**/player_api.php?**',async route=>{
      const action=new URL(route.request().url()).searchParams.get('action');
      await route.fulfill({json:fixture[action]||{user_info:{auth:1,status:'Active'},server_info:{}}});
    });
    await p.goto(base);
    await p.locator('#m3u-url').fill(base+'/get.php?username=fixture&password=fixture&output=ts');
    await p.locator('[data-act="login"]').click();
    await p.waitForURL('**/#/home');
    assert.equal(await p.locator('#view').getAttribute('data-view'),'home');
    const homeText=await p.locator('#view').innerText();
    assert.match(homeText,/Explorar categorias/);
    assert.match(homeText,/Filmes adicionados recentemente/);
    assert.match(homeText,/Séries do catálogo/);
    assert.match(homeText,/Canais esportivos/);
    assert.match(homeText,/Explorar por plataforma/);
    assert.doesNotMatch(homeText,/Destaques para Você|Jogos de Hoje/);
    console.log('PASS: seções da página inicial baseadas no catálogo real');

    const next=p.locator('.home-categories .carousel-arrow.next');
    await next.waitFor();
    assert.equal(await next.isVisible(),true);
    assert.equal(await next.isEnabled(),true);
    await next.click();
    await p.waitForFunction(()=>document.querySelector('.home-categories .hubs').scrollLeft>15);
    console.log('PASS: setas do carrossel em desktop');

    await p.keyboard.press('/');
    await p.waitForURL('**/#/search');
    await p.locator('#q').waitFor();
    assert.equal(await p.locator('#q').evaluate(el=>document.activeElement===el),true);
    await p.locator('#q').fill('filme 2');
    await p.locator('.search-suggestion').first().waitFor();
    assert.ok(await p.locator('.search-suggestion').count()>0);
    await p.locator('.search-suggestion').first().click();
    assert.ok((await p.locator('#q').inputValue()).toLowerCase().includes('filme'));
    assert.ok(await p.locator('#results .card').count()>0);
    await p.locator('#q').fill('Filme 17');
    await p.locator('#q').press('Enter');
    await p.locator('#q').fill('');
    await p.locator('.search-history-item').first().waitFor();
    assert.match(await p.locator('.search-history-list').innerText(),/Filme 17/);
    await p.locator('[data-act="searchclear"]').click();
    assert.equal(await p.locator('.search-history-item').count(),0);
    await p.locator('[data-act="stype"][data-t="live"]').click();
    await p.locator('#q').fill('Canal 1');
    await p.locator('#results .card').first().waitFor();
    assert.equal(await p.locator('#results .card-poster').count(),0);
    assert.ok(await p.locator('#results .card-live').count()>0);
    console.log('PASS: atalho /, sugestões, buscas recentes, limpeza e filtro de tipo');

    await p.locator('#mainnav [data-route="#/home"]').click();
    await p.evaluate(async()=>{
      const {Store}=await import('./js/storage.js?v=1.10.0');
      Store.saveProgress({id:'l1',type:'live',name:'Canal 1',group:'Esportes'},0,0);
    });
    await p.locator('#mainnav [data-route="#/home"]').click();
    assert.match(await p.locator('#view').innerText(),/Últimos canais acessados/);
    console.log('PASS: últimos canais realmente acessados, sem inferir programação');

    await p.setViewportSize({width:390,height:844});
    assert.equal(await p.locator('#mobile-nav').isVisible(),true);
    assert.equal(await p.locator('.carousel-arrow').first().isVisible(),false);
    await p.locator('#mobile-nav [data-route="#/search"]').click();
    assert.equal(await p.locator('#q').isVisible(),true);
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);
    console.log('PASS: navegação celular 390px, sem rolagem horizontal ou erros JS');
    await ctx.close();
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
