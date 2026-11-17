// Virtualização da grade. Mantém uma janela de cartões e espaçamento equivalente
// aos itens fora da tela. Não faz requisições, nem altera a lista, filtros ou player.
export const VIRTUAL_THRESHOLD = 1500;
export const MAX_VISIBLE = 216;
const OVERSCAN_ROWS = 5;

export function windowBounds(total,columns,firstRow,visibleRows) {
  const cols=Math.max(1,columns|0), rows=Math.ceil(total/cols);
  const startRow=Math.max(0,Math.min(rows-1,Math.floor(firstRow)-OVERSCAN_ROWS));
  const rowCount=Math.min(Math.ceil(MAX_VISIBLE/cols),Math.max(1,visibleRows+OVERSCAN_ROWS*2));
  const countRows=Math.max(1,rowCount);
  const endRow=Math.min(rows,startRow+countRows);
  return {start:startRow*cols,end:Math.min(total,endRow*cols),startRow,endRow,totalRows:rows};
}

export function mountCatalogWindow({grid,items,render,focus,observe,scrollContainer,initialIndex=0}) {
  const parent=scrollContainer===window?window:scrollContainer;
  const count=items.length;
  let destroyed=false,queued=false,range={start:0,end:0};
  let cols=1,step=205;
  let renderCount=0;
  const measured=()=> {
    const style=getComputedStyle(grid);
    const templates=style.gridTemplateColumns.trim().split(/\s+/);
    cols=Math.max(1,templates.length);
    const cards=[...grid.querySelectorAll('.card-wrap')];
    if(cards.length>cols) {
      const first=cards[0],second=cards[cols];
      if(first&&second&&second.offsetTop>first.offsetTop)
        step=Math.max(60,second.offsetTop-first.offsetTop);
    }
  };
  const gridTop=()=>{
    const rect=grid.getBoundingClientRect();
    if(parent===window)return rect.top+window.scrollY;
    const bounds=parent.getBoundingClientRect();
    return rect.top-bounds.top+parent.scrollTop;
  };
  const currentScroll=()=>parent===window?window.scrollY:parent.scrollTop;
  const viewportSize=()=>parent===window?window.innerHeight:parent.clientHeight;
  const calculate=()=>{
    const y=Math.max(0,currentScroll()-gridTop());
    return windowBounds(count,cols,Math.floor(y/step),Math.ceil(viewportSize()/step)+2);
  };
  const paint=(next,force=false)=>{
    if(destroyed)return;
    if(!force&&next.start===range.start&&next.end===range.end)return;
    const active=document.activeElement;
    const focused=active?.closest?.('.card[data-vi]');
    const focusedIndex=focused?Number(focused.dataset.vi):-1;
    range=next;
    grid.style.paddingTop=(next.startRow*step)+'px';
    grid.style.paddingBottom=(Math.max(0,next.totalRows-next.endRow)*step)+'px';
    grid.innerHTML=items.slice(next.start,next.end).map((item,i)=>render(item,next.start+i)).join('');
    renderCount++;
    if(observe)observe(grid);
    // Conserva o foco quando o cartão ainda pertence à janela renderizada.
    if(focusedIndex>=next.start&&focusedIndex<next.end){
      const replacement=grid.querySelector('.card[data-vi="'+focusedIndex+'"]');
      if(replacement)replacement.focus({preventScroll:true});
    }
  };
  // Mede a altura real dos cartões e o número real de colunas antes de
  // construir uma grade que pode ter milhares de itens.
  paint({start:0,end:Math.min(count,120),startRow:0,
    endRow:Math.ceil(Math.min(count,120)/cols),totalRows:Math.ceil(count/cols)},true);
  measured();
  // Garante linhas completas e no máximo MAX_VISIBLE cartões por janela.
  const initial=Math.max(0,Math.min(count-1,initialIndex|0));
  const firstRow=Math.floor(initial/cols);
  paint(windowBounds(count,cols,Math.max(0,firstRow-2),Math.ceil(viewportSize()/step)+2),true);
  const onScroll=()=>{
    if(destroyed||queued)return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      if(destroyed||!grid.isConnected)return;
      const next=calculate();
      // Evita recriar cartões a cada poucos pixels de rolagem.
      const mid=next.start+Math.floor((next.end-next.start)/2);
      if(mid>=range.start+cols*3&&mid<range.end-cols*3)return;
      paint(next);
    });
  };
  parent.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll,{passive:true});
  const moveFocus=(dir,cur)=>{
    if(destroyed||!cur?.dataset?.vi)return false;
    const idx=Number(cur.dataset.vi);
    const col=idx%cols;
    let next=idx;
    if(dir==='down')next+=cols;
    else if(dir==='up') {
      if(idx<cols)return false;
      next-=cols;
    }else if(dir==='right') {
      if(col===cols-1)return true;
      next++;
    }else if(dir==='left') {
      if(col===0)return false;
      next--;
    }else return false;
    if(next<0||next>=count)return true;
    if(next<range.start||next>=range.end) {
      const first=Math.max(0,Math.floor(next/cols)-OVERSCAN_ROWS);
      paint(windowBounds(count,cols,first+OVERSCAN_ROWS,Math.ceil(viewportSize()/step)+2));
    }
    const target=grid.querySelector('.card[data-vi="'+next+'"]');
    if(target)focus(target);
    return true;
  };
  grid._virtualMove=moveFocus;
  grid._virtualDebug=()=>({start:range.start,end:range.end,count,cols,step,domCards:grid.querySelectorAll('.card').length,renderCount});
  onScroll();
  return {
    destroy() {
      destroyed=true;
      parent.removeEventListener('scroll',onScroll);
      window.removeEventListener('resize',onScroll);
      delete grid._virtualMove;
      delete grid._virtualDebug;
    },
    refresh:onScroll,
    debug:()=>grid._virtualDebug?.()
  };
}
