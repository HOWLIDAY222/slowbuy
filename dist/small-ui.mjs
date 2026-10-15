import {SMALL_KEY,MAX_SMALL,readSmall,dailyKey,nextMorning,summarizeSmall} from './small.mjs';

export function initSmallPurchases({toast}) {
  const get=id=>document.getElementById(id);
  const money=new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'});
  const when=new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  let items=[],canStore=true,night=false,view='single',reviewId=null;
  const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  function warning(text){get('small-storage-warning').textContent=text;get('small-storage-warning').hidden=!text;}
  function refresh(){
    if(!canStore)return;
    try {const result=readSmall(localStorage.getItem(SMALL_KEY));items=result.items;if(result.malformed)warning('部分小单数据无法识别，已保留可读取的记录。');}
    catch {canStore=false;warning('浏览器无法读取或保存小单，当前记录仅在本次打开期间保留。');}
  }
  function persist(){
    try {localStorage.setItem(SMALL_KEY,JSON.stringify({version:1,items}));canStore=true;warning('');}
    catch {canStore=false;warning('小单未能保存。当前记录只在本次打开期间保留，关闭页面可能丢失。');}
  }
  function changeView(next){
    view=next;night=next==='night';get('single-tool').hidden=next!=='single';get('small-tool').hidden=next==='single';
    for(const button of document.querySelectorAll('[data-tool]')){const selected=button.dataset.tool===next;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
    get('small-tool').classList.toggle('night-mode',night);
    get('small-title').textContent=night?'先睡一觉，明早再看。':'每件都不贵，今天一共呢？';
    get('small-eyebrow').textContent=night?'给今晚的心动一个暂停键':'小单，也有总价';
    get('small-lead').textContent=night?'不用现在说服自己，只把想买的东西留在这里。':'只记一笔价格，就能看到小额消费的累积。';
    get('small-add').textContent=night?'记下，早上再决定':'先记下，暂时不买';
    get('small-add-bought').hidden=night;get('small-night-note').hidden=!night;
    get('small-night-toggle').textContent=night?'退出睡前模式':'开启睡前模式';get('small-night-toggle').setAttribute('aria-pressed',String(night));
    refresh();render();
  }
  function updateProjection(summary){
    const count=Number(get('small-frequency').value),valid=Number.isInteger(count)&&count>=1&&count<=31;
    get('small-frequency').setAttribute('aria-invalid',String(!valid));
    const total=(Math.round(summary.todayPlanned*100)+Math.round(summary.todayBought*100))/100;
    get('small-projection-text').textContent=!valid?'类似天数请填 1–31 的整数。':total===0?'先记下一笔，再看看累加后的金额。':`今天 ${summary.todayCount} 笔合计 ${money.format(total)}。如果每月有 ${count} 天都买下这些，一个月就是 ${money.format(Math.round(total*100)*count/100)}。`;
  }
  function statusText(item,now){
    if(item.status==='bought')return '已买 · '+when.format(item.decidedAt||item.createdAt);
    if(item.status==='released')return '已放下 · 不计入支出';
    return item.reviewAt?(item.reviewAt<=now?'到了复盘时间，再看看':'先等到 '+when.format(item.reviewAt)):'待买 · 还没有算作支出';
  }
  function render(){
    const now=Date.now(),summary=summarizeSmall(items,now),today=dailyKey(now);
    get('small-today-bought').textContent=money.format(summary.todayBought);get('small-today-planned').textContent=money.format(summary.todayPlanned);get('small-month-bought').textContent=money.format(summary.monthBought);
    get('small-stat-note').textContent='按设备本地日期统计；已买按确认购买日计入。待买不算已支出，放下不算已节省。';
    get('small-pending-count').textContent=items.filter(i=>i.status==='planned').length+' 笔待决定';updateProjection(summary);
    const all=get('small-history').checked;
    const visible=items.filter(i=>all||i.status==='planned'||dailyKey(i.decidedAt||i.createdAt)===today).sort((a,b)=>(a.status==='planned'?0:1)-(b.status==='planned'?0:1)||b.createdAt-a.createdAt);
    const focused=document.activeElement?.closest('[data-small-action]');const focusId=focused?.closest('[data-small-id]')?.dataset.smallId,focusAction=focused?.dataset.smallAction;
    const fragment=document.createDocumentFragment();
    for(const item of visible){
      const row=node('article','small-item');row.dataset.smallId=item.id;
      const main=node('div','small-item-main');main.append(node('h4','',item.name),node('p','',statusText(item,now)));
      const price=node('strong','small-item-price',money.format(item.price)),actions=node('div','small-item-actions');
      const action=(name,label)=>{const button=node('button','',label);button.type='button';button.dataset.smallAction=name;button.setAttribute('aria-label',label+'：'+item.name);actions.append(button);};
      if(item.status==='planned')action('review',item.reviewAt&&item.reviewAt>now?'提前想一想':'看看还想不想买');
      else action('reopen',item.status==='bought'?'改为待买':'重新待买');
      action('delete','移除');row.append(main,price,actions);fragment.append(row);
    }
    get('small-list').replaceChildren(fragment);get('small-empty').hidden=visible.length>0;
    if(focusId){const row=[...get('small-list').children].find(r=>r.dataset.smallId===focusId);row?.querySelector(`[data-small-action="${focusAction}"]`)?.focus({preventScroll:true});}
  }
  function add(status){
    const input=get('small-price'),price=Number(input.value),cents=Math.round(price*100);
    const valid=input.value.trim()!==''&&Number.isFinite(price)&&price>=0.01&&price<=1e8&&Math.abs(price*100-cents)<1e-5;
    get('small-error').textContent=valid?'':'价格请填 0.01 元至 1 亿元，最多两位小数。';input.setAttribute('aria-invalid',String(!valid));if(!valid){input.focus();return;}
    refresh();if(items.length>=MAX_SMALL){toast('最多保留 300 笔小单，请先移除不再需要的历史记录。');return;}
    const now=Date.now(),item={id:crypto.randomUUID(),name:get('small-name').value.trim()||'一笔小单',price:cents/100,status,createdAt:now};
    if(status==='bought')item.decidedAt=now;else if(night)item.reviewAt=nextMorning(now);
    items.unshift(item);persist();render();get('small-form').reset();get('small-error').textContent='';input.removeAttribute('aria-invalid');get('small-name').focus();
    toast(canStore?(night?'记下了，'+when.format(item.reviewAt)+'再看。':status==='bought'?'已记为实际支出。':'已记下，待买不计入支出。'):'已加入本次记录，但浏览器未能保存。');
  }
  function openReview(id){
    refresh();const item=items.find(i=>i.id===id&&i.status==='planned');if(!item){render();return;}
    reviewId=id;get('small-review-product').textContent=item.name+' · '+money.format(item.price);
    get('small-review-time').textContent=item.reviewAt&&item.reviewAt>Date.now()?'原定 '+when.format(item.reviewAt)+' 再看，现在也可以提前复盘。':'从单件价格里抬起头，也看看今天的小单合计。';
    get('small-review-title').textContent=item.reviewAt?'现在，还想买吗？':'这件小单，想好了吗？';get('small-review-dialog').showModal();
  }
  function decide(status){
    refresh();const item=items.find(i=>i.id===reviewId&&i.status==='planned');if(!item){get('small-review-dialog').close();render();toast('这笔小单已在其他页面更新，请重新查看。');return;}
    item.status=status;item.decidedAt=Date.now();delete item.reviewAt;persist();get('small-review-dialog').close();render();toast(status==='bought'?'已计入确认购买当天的支出。':'已放下，不会记成已经省下的钱。');
  }
  for(const button of document.querySelectorAll('[data-tool]'))button.addEventListener('click',()=>changeView(button.dataset.tool));
  for(const link of document.querySelectorAll('a[href="#calculator"],a[href="#wishlist"]'))link.addEventListener('click',()=>changeView('single'));
  get('small-night-toggle').addEventListener('click',()=>changeView(night?'small':'night'));
  get('small-form').addEventListener('submit',event=>{event.preventDefault();add('planned');});get('small-add-bought').addEventListener('click',()=>add('bought'));
  get('small-frequency').addEventListener('input',()=>updateProjection(summarizeSmall(items,Date.now())));get('small-history').addEventListener('change',render);
  get('small-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-small-action]');if(!button)return;const id=button.closest('[data-small-id]').dataset.smallId;
    if(button.dataset.smallAction==='review'){openReview(id);return;}
    refresh();const index=items.findIndex(i=>i.id===id);if(index<0){render();return;}
    if(button.dataset.smallAction==='reopen'){const wasBought=items[index].status==='bought';items[index].status='planned';items[index].createdAt=Date.now();delete items[index].decidedAt;items[index].reviewAt=nextMorning(Date.now());persist();render();toast(wasBought?'已改为待买，并从已买统计中移除。':'已重新留到下个早上。');}
    else {const removed=items.splice(index,1)[0];persist();render();toast('已移除小单。',()=>{refresh();if(items.length<MAX_SMALL&&!items.some(i=>i.id===removed.id))items.unshift(removed);persist();render();toast('小单已恢复。');});}
  });
  get('small-release').addEventListener('click',()=>decide('released'));get('small-bought').addEventListener('click',()=>decide('bought'));
  get('small-later').addEventListener('click',()=>{refresh();const item=items.find(i=>i.id===reviewId&&i.status==='planned');if(item){item.reviewAt=nextMorning(Date.now());persist();}get('small-review-dialog').close();render();toast(item?'再给自己留到下个早上。':'这笔小单已在其他页面更新，请重新查看。');});
  window.addEventListener('storage',event=>{if(event.key===SMALL_KEY||event.key===null){refresh();render();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refresh();render();}});
  setInterval(()=>{if(document.visibilityState==='visible'&&view!=='single')render();},60000);
  refresh();render();
}
