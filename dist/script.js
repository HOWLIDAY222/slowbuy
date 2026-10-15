(()=>{
"use strict";
const STORAGE_KEY = 'slowbuy.items.v1';
const MAX_ITEMS = 100;
const EXAMPLES = [
  {name:'降噪耳机',price:1299,income:8000,days:22,hours:8,uses:100},
  {name:'周末咖啡机',price:2699,income:10000,days:22,hours:8,uses:300},
  {name:'一双新球鞋',price:899,income:6000,days:22,hours:8,uses:80}
];
function validate(values, requireName=false) {
  const errors = {};
  if(requireName && !String(values.name||'').trim()) errors.name='给这次心动取个名字。';
  if(!Number.isFinite(values.price)||values.price<0.01||values.price>1e8) errors.price='填写 0.01 元至 1 亿元的价格。';
  if(!Number.isFinite(values.income)||values.income<0.01||values.income>1e8) errors.income='填写 0.01 元至 1 亿元的每月到手收入。';
  if(!Number.isInteger(values.days)||values.days<1||values.days>31) errors.days='填写 1–31 的整数。';
  if(!Number.isFinite(values.hours)||values.hours<0.1||values.hours>24) errors.hours='填写 0.1–24 小时。';
  if(!Number.isInteger(values.uses)||values.uses<1||values.uses>10000) errors.uses='填写 1–10000 的整数。';
  return errors;
}
function calculate(values) {
  if(Object.keys(validate(values)).length) return null;
  const hourlyIncome=values.income/(values.days*values.hours);
  const workHours=values.price/hourlyIncome;
  return {hourlyIncome,workHours,workDays:workHours/values.hours,perUse:values.price/values.uses,incomeShare:values.price/values.income*100};
}
function usagePlan(price,targetCost,weeklyUses) {
  if(!Number.isFinite(price)||price<0.01||price>1e8||!Number.isFinite(targetCost)||targetCost<0.01||targetCost>1e8||!Number.isFinite(weeklyUses)||weeklyUses<0.1||weeklyUses>1000)return null;
  const ratio=price/targetCost;
  const neededUses=Math.max(1,Math.ceil(ratio-Number.EPSILON*ratio*2));
  const weeks=neededUses/weeklyUses;
  return {neededUses,neededWeeks:Math.max(1,Math.ceil(weeks-Number.EPSILON*weeks*2)),targetCost,weeklyUses};
}
function goalComparison(price,goalTotal,goalSaved) {
  if(!Number.isFinite(price)||price<0.01||price>1e8||!Number.isFinite(goalTotal)||goalTotal<0.01||goalTotal>1e8||!Number.isFinite(goalSaved)||goalSaved<0||goalSaved>1e8)return null;
  const before=Math.min(100,goalSaved/goalTotal*100);
  const after=Math.min(100,(goalSaved+price)/goalTotal*100);
  return {contribution:price/goalTotal*100,before,after,extra:Math.max(0,after-before),remaining:Math.max(0,goalTotal-goalSaved-price)};
}
function validRecord(item) {
  return item && typeof item==='object' && typeof item.id==='string' && item.id.length<100 && typeof item.name==='string' && item.name.trim().length>0 && item.name.length<=60 && ['waiting','released','wanted'].includes(item.status) && ['price','workHours','perUse','createdAt','dueAt','periodHours'].every(key=>Number.isFinite(item[key])&&item[key]>0) && item.price<=1e8 && item.dueAt<=8.64e15 && item.createdAt<=item.dueAt && [24,72,168].includes(item.periodHours);
}
function decodeRecords(raw) {
  if(raw===null) return {items:[],malformed:false};
  try {
    const data=JSON.parse(raw);
    if(data.version!==1||!Array.isArray(data.items)) return {items:[],malformed:true};
    const filtered=data.items.filter(validRecord).slice(0,MAX_ITEMS);
    const unique=filtered.filter((item,index,arr)=>arr.findIndex(other=>other.id===item.id)===index);
    return {items:unique,malformed:unique.length!==data.items.length};
  } catch { return {items:[],malformed:true}; }
}
function remainingLabel(dueAt, now=Date.now()) {
  const ms=dueAt-now;
  if(ms<=0) return '冷静期已到，可以再想一想';
  const minutes=Math.max(1,Math.ceil(ms/60000));
  const days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),mins=minutes%60;
  if(days) return `还剩 ${days} 天${hours ? ` ${hours} 小时` : ''}`;
  if(hours) return `还剩 ${hours} 小时${mins ? ` ${mins} 分钟` : ''}`;
  return `还剩 ${mins} 分钟`;
}


// Monetary arithmetic uses cents so boundary decisions do not depend on float noise.
function budgetPlan(v) {
  const keys=['price','income','cash','expenses','debt','reserveMonths'];
  if(keys.some(k=>!Number.isFinite(v[k])||v[k]<0||v[k]>1e8)||v.price<0.01||!Number.isInteger(v.reserveMonths)||v.reserveMonths>120||!['cash','installment'].includes(v.payment))return null;
  const cents=n=>Math.round(n*100);
  const price=cents(v.price),income=cents(v.income),cash=cents(v.cash),expenses=cents(v.expenses),debt=cents(v.debt);
  const installment=v.payment==='installment';
  if(installment&&(!Number.isFinite(v.down)||v.down<0||cents(v.down)>price||!Number.isFinite(v.fee)||v.fee<0||v.fee>1e8||!Number.isInteger(v.months)||v.months<1||v.months>120))return null;
  const upfront=installment?cents(v.down):price,financed=price-upfront;
  const monthly=installment?(financed+cents(v.fee))/v.months:0;
  const base=income-expenses-debt,reserve=(expenses+debt)*v.reserveMonths;
  const cashLeft=cash-upfront,gap=Math.max(0,price+reserve-cash),monthlyLeft=base-monthly;
  return {cashLeft:cashLeft/100,reserve:reserve/100,monthly:monthly/100,monthlyLeft:monthlyLeft/100,base:base/100,financed:financed/100,gap:gap/100,savingMonths:gap===0?0:base>0?Math.ceil(gap/base):null,upfrontShort:cashLeft<0,reserveShort:cashLeft<reserve,monthlyShort:monthlyLeft<0,installment};
}

const SMALL_KEY = 'slowbuy.small.v1';
const MAX_SMALL = 300;

const MAX_TIME = 8.64e15;
const statuses = new Set(['planned', 'bought', 'released']);
const isTimestamp = value => Number.isFinite(value) && value > 0 && value <= MAX_TIME;

// Stored amounts must already have cent precision; allow only floating-point noise.
function priceCents(value) {
  if (!Number.isFinite(value) || value < 0.01 || value > 1e8) return null;
  const scaled = value * 100;
  const cents = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.abs(scaled - cents) <= tolerance ? cents : null;
}

function readSmall(raw) {
  if (raw === null) return {items: [], malformed: false};
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.items)) {
      return {items: [], malformed: true};
    }
    const items = [];
    const ids = new Set();
    let malformed = false;
    for (const entry of data.items) {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      const name = typeof entry?.name === 'string' ? entry.name.trim().slice(0, 60) : '';
      const cents = priceCents(entry?.price);
      if (!entry || !id || id.length > 100 || !name || cents === null ||
          !statuses.has(entry.status) || !isTimestamp(entry.createdAt) || ids.has(id)) {
        malformed = true;
        continue;
      }
      if (items.length === MAX_SMALL) {
        malformed = true;
        continue;
      }
      const item = {id, name, price: cents / 100, status: entry.status, createdAt: entry.createdAt};
      for (const field of ['decidedAt', 'reviewAt']) {
        if (Object.prototype.hasOwnProperty.call(entry, field)) {
          if (isTimestamp(entry[field])) item[field] = entry[field];
          else malformed = true;
        }
      }
      ids.add(id);
      items.push(item);
    }
    return {items, malformed};
  } catch {
    return {items: [], malformed: true};
  }
}

function dailyKey(timestamp) {
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > MAX_TIME) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextMorning(now = Date.now()) {
  if (!Number.isFinite(now) || Math.abs(now) > MAX_TIME) throw new RangeError('Invalid timestamp');
  const morning = new Date(now);
  morning.setHours(9, 0, 0, 0);
  if (morning.getTime() <= now) morning.setDate(morning.getDate() + 1);
  const result = morning.getTime();
  if (!Number.isFinite(result)) throw new RangeError('Next morning is outside the supported date range');
  return result;
}

function summarizeSmall(items, now = Date.now()) {
  const today = dailyKey(now);
  const result = {todayPlanned: 0, todayBought: 0, monthBought: 0, todayCount: 0};
  if (!today || !Array.isArray(items)) return result;
  const month = today.slice(0, 7);
  let plannedCents = 0, boughtCents = 0, monthCents = 0;
  for (const item of items) {
    const cents = priceCents(item?.price);
    if (cents === null || !isTimestamp(item?.createdAt)) continue;
    if (item.status === 'planned' && dailyKey(item.createdAt) === today) {
      plannedCents += cents;
      result.todayCount += 1;
    } else if (item.status === 'bought') {
      const purchaseTime = isTimestamp(item.decidedAt) ? item.decidedAt : item.createdAt;
      const purchaseDay = dailyKey(purchaseTime);
      if (purchaseDay === today) {
        boughtCents += cents;
        result.todayCount += 1;
      }
      if (purchaseDay.slice(0, 7) === month) monthCents += cents;
    }
  }
  result.todayPlanned = plannedCents / 100;
  result.todayBought = boughtCents / 100;
  result.monthBought = monthCents / 100;
  return result;
}


function initSmallPurchases({toast}) {
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


const $=id=>document.getElementById(id);
const form=$('calculator');
const fields={name:$('product-name'),price:$('product-price'),income:$('monthly-income'),days:$('work-days'),hours:$('work-hours'),uses:$('use-count')};
const yuan=new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2,maximumFractionDigits:2});
const decimal=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1,minimumFractionDigits:1});
const dateFormat=new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
let records=[];
let filter='waiting';
let exampleIndex=0;
let reviewId=null;
let toastTimer;
let undo=null;
let storageAvailable=true;
let liveAnnouncement;
let receiptSnapshot=null;
const reasonHints={need:'想一个具体场景：买回来之后，你最先会在什么时候用它？',upgrade:'现在手上的那件，究竟哪里不够用了？',seed:'先想想，平时会在什么场景里用到它？',sale:'把折扣拿掉，这个东西还在你的购物计划里吗？'};
const reasonNames={need:'确实需要',upgrade:'想升级',seed:'被种草了',sale:'打折怕错过'};
const integer=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0});

function values(){return Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,key==='name'?input.value.trim():input.value.trim()===''?NaN:Number(input.value)]));}
function storageWarning(message){const notice=$('storage-warning');notice.textContent=message;notice.hidden=!message;}
function load(){
  try {
    const {items,malformed}=decodeRecords(localStorage.getItem(STORAGE_KEY));
    storageAvailable=true;
    if(malformed)storageWarning('部分旧记录无法读取，已保留可以识别的记录。');
    return items;
  } catch {
    storageAvailable=false;
    storageWarning('浏览器暂时无法保存记录。当前清单只在这次打开期间保留，关闭后可能丢失。');
    return records;
  }
}
function persist(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,items:records}));storageAvailable=true;storageWarning('');}
  catch{storageAvailable=false;storageWarning('记录未能保存到浏览器。当前清单只在这次打开期间保留，请勿关闭页面。');}
}
function toast(message,undoAction=null){
  clearTimeout(toastTimer);undo=undoAction;$('toast-message').textContent=message;$('toast-undo').hidden=!undoAction;$('toast').hidden=false;
  toastTimer=setTimeout(()=>{$('toast').hidden=true;undo=null;},undoAction?12000:4500);
}
function paintErrors(errors){
  for(const [key,input]of Object.entries(fields)){
    const el=$(key+'-error');if(el)el.textContent=errors[key]||'';
    if(errors[key])input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');
  }
}
function syncRange(){
  const count=Number(fields.uses.value);
  if(Number.isFinite(count)&&count>=1)$('use-range').value=Math.min(1000,count);
  const progress=(Number($('use-range').value)-1)/999*100;
  $('use-range').style.background=`linear-gradient(to right, var(--green) ${progress}%, #d3dfdc ${progress}%)`;
}
function updateCalculation(announce=true){
  const data=values(),errors=validate(data);
  if(fields.name.hasAttribute('aria-invalid')&&!data.name)errors.name='给这次心动取个名字。';
  paintErrors(errors);syncRange();
  $('work-summary').textContent=errors.days||errors.hours?'工作时间需要调整':`工作时间：${data.days} 天/月 · ${data.hours} 小时/天`;
  const result=calculate(data);
  if(!result){
    for(const id of ['time-cost','day-cost','per-use','income-share','hourly-income'])$(id).textContent='—';
    $('income-progress').style.width='0%';
    $('income-progress').parentElement.setAttribute('aria-valuenow','0');
    $('ratio-note').textContent='填写有效数字后，试算会自动更新。';
    $('calculation-status').textContent='请检查标出的输入项。';
    $('time-thought').textContent='填写有效数字后，时间账会自动更新。';
    updateScenarios(data,null);
    return null;
  }
  const timeText=decimal.format(result.workHours);
  $('time-cost').textContent=timeText;
  $('time-cost').parentElement.classList.toggle('long-number',timeText.length>7);
  $('day-cost').textContent=decimal.format(result.workDays);
  $('per-use').textContent=yuan.format(result.perUse);
  $('per-use').classList.toggle('compact',yuan.format(result.perUse).length>12);
  $('income-share').textContent=decimal.format(result.incomeShare)+'%';
  $('hourly-income').textContent=yuan.format(result.hourlyIncome);
  $('income-share').classList.toggle('compact',decimal.format(result.incomeShare).length>9);
  $('income-progress').style.width=Math.min(100,result.incomeShare)+'%';
  $('income-progress').parentElement.setAttribute('aria-valuenow',String(Math.min(100,result.incomeShare)));
  $('income-progress').parentElement.setAttribute('aria-valuetext',`占月收入的 ${decimal.format(result.incomeShare)}%`);
  $('ratio-note').textContent=`相当于你一个月收入的 ${decimal.format(result.incomeShare)}%`;
  $('time-thought').textContent=`${data.name||'这件东西'}，约等于 ${decimal.format(result.workDays)} 个工作日的收入。`;
  updateScenarios(data,result);
  clearTimeout(liveAnnouncement);
  if(announce)liveAnnouncement=setTimeout(()=>{$('calculation-status').textContent=`约需工作 ${timeText} 小时，每次使用 ${yuan.format(result.perUse)}，占月收入 ${decimal.format(result.incomeShare)}%。`;},600);
  return result;
}
function numberValue(id){const text=$(id).value.trim();return text===''?NaN:Number(text);}
function updateScenarios(data,result){
  updateBudget(data);
  const plan=usagePlan(data.price,numberValue('target-cost'),numberValue('uses-week'));
  const goal=goalComparison(data.price,numberValue('goal-total'),numberValue('goal-saved'));
  const goalName=$('goal-name').value.trim();
  const priceValid=Number.isFinite(data.price)&&data.price>=0.01&&data.price<=1e8;
  for(const button of document.querySelectorAll('[data-uses]')){const active=Number(button.dataset.uses)===data.uses;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  $('target-error').hidden=!!plan;
  $('target-error').textContent=plan?'':priceValid?'每次成本请填 0.01 元至 1 亿元，每周次数请填 0.1–1000。':'先填写有效的商品价格。';
  for(const [id,valid]of [['target-cost',Number.isFinite(numberValue('target-cost'))&&numberValue('target-cost')>=0.01&&numberValue('target-cost')<=1e8],['uses-week',Number.isFinite(numberValue('uses-week'))&&numberValue('uses-week')>=0.1&&numberValue('uses-week')<=1000]]){if(valid)$(id).removeAttribute('aria-invalid');else $(id).setAttribute('aria-invalid','true');}
  $('needed-uses').textContent=plan?integer.format(plan.neededUses):'—';
  $('usage-standard').textContent=plan?`把每次使用成本降到 ${yuan.format(plan.targetCost)}，才达到你设定的标准。`:'设置自己愿意承担的每次成本，再看看需要用到多少次。';
  $('usage-plan').textContent=plan?`按每周 ${plan.weeklyUses} 次，需要约 ${integer.format(plan.neededWeeks)} 周用到 ${integer.format(plan.neededUses)} 次。${result?(data.uses<plan.neededUses?`你目前预估 ${integer.format(data.uses)} 次，比这个标准少 ${integer.format(plan.neededUses-data.uses)} 次。`:'按你预估的使用次数，可以达到这个标准。'):''}`:'修改上方标出的数字，使用计划会自动更新。';
  $('goal-error').hidden=!!goal&&!!goalName;
  $('goal-error').textContent=goal&&goalName?'':priceValid?'填写目标名称、0.01 元至 1 亿元的目标金额，以及不小于 0 的已存金额。':'先填写有效的商品价格。';
  for(const [id,valid]of [['goal-name',!!goalName],['goal-total',Number.isFinite(numberValue('goal-total'))&&numberValue('goal-total')>=0.01&&numberValue('goal-total')<=1e8],['goal-saved',Number.isFinite(numberValue('goal-saved'))&&numberValue('goal-saved')>=0&&numberValue('goal-saved')<=1e8]]){if(valid)$(id).removeAttribute('aria-invalid');else $(id).setAttribute('aria-invalid','true');}
  $('goal-contribution').textContent=goal&&goalName?decimal.format(goal.contribution)+'%':'—';
  $('goal-existing').style.width=goal&&goalName?goal.before+'%':'0%';
  $('goal-extra').style.width=goal&&goalName?goal.extra+'%':'0%';
  $('goal-impact').textContent=goal&&goalName?`如果把 ${yuan.format(data.price)} 存给「${goalName}」，进度会从 ${decimal.format(goal.before)}% 到 ${decimal.format(goal.after)}%。${goal.remaining>0?`之后还差 ${yuan.format(goal.remaining)}。`:'会达到或超过目标金额。'}`:'修改目标后，再看看这笔钱可以做什么。';
  $('goal-existing').parentElement.setAttribute('aria-label',goal&&goalName?`目前已存 ${decimal.format(goal.before)}%，假设再存下商品价格后达到 ${decimal.format(goal.after)}%。`:'目标数据尚未填写完整');
}
function selectScene(scene,focus=false){
  for(const button of document.querySelectorAll('[data-scene]')){const active=button.dataset.scene===scene;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$('scene-'+button.dataset.scene).hidden=!active;if(active&&focus)button.focus();}
}
function focusInvalid(key){
  if(key==='days'||key==='hours')$('work-details').open=true;
  if(key==='uses')selectScene('usage');
  fields[key].focus();
}
function buildReceipt(){
  const data=values(),errors=validate(data,true);paintErrors(errors);
  if(Object.keys(errors).length){focusInvalid(Object.keys(errors)[0]);toast('先检查一下标出的输入项。');return null;}
  return {data,result:calculate(data),plan:usagePlan(data.price,numberValue('target-cost'),numberValue('uses-week')),goal:$('goal-name').value.trim()?goalComparison(data.price,numberValue('goal-total'),numberValue('goal-saved')):null,goalName:$('goal-name').value.trim(),periodHours:Number(form.elements.cooldown.value),createdAt:Date.now()};
}
function receiptText(snapshot){
  const {data,result,plan,goal,goalName,periodHours}=snapshot;
  return ['慢半拍 · 心动账单',data.name+'｜'+yuan.format(data.price),'换成工作时间：'+decimal.format(result.workHours)+' 小时，约 '+decimal.format(result.workDays)+' 个工作日。','预计用 '+integer.format(data.uses)+' 次，每次 '+yuan.format(result.perUse)+'。',plan?'想让每次成本不超过 '+yuan.format(plan.targetCost)+'，需要用到 '+integer.format(plan.neededUses)+' 次。':'',goal?'如果留给「'+goalName+'」，这笔钱相当于目标的 '+decimal.format(goal.contribution)+'%。':'','先等 '+(periodHours===168?'7 天':periodHours+' 小时')+'，再看看自己还想不想要。','买不买，由你决定。'].filter(Boolean).join('\n');
}
function openReceipt(){
  const snapshot=buildReceipt();if(!snapshot)return;receiptSnapshot=snapshot;
  const {data,result,plan,goal,goalName,periodHours}=snapshot;
  $('receipt-name').textContent=data.name;$('receipt-price').textContent=yuan.format(data.price);
  $('receipt-time').textContent=decimal.format(result.workHours)+' 小时 / '+decimal.format(result.workDays)+' 天';
  $('receipt-uses-label').textContent='预计使用 '+integer.format(data.uses)+' 次';$('receipt-uses').textContent=yuan.format(result.perUse)+' / 次';
  $('receipt-standard').textContent=plan?integer.format(plan.neededUses)+' 次（≤'+yuan.format(plan.targetCost)+'/次）':'未设置';
  $('receipt-goal-label').textContent=goal?'如果留给「'+goalName+'」':'另一种选择';$('receipt-goal').textContent=goal?'相当于目标的 '+decimal.format(goal.contribution)+'%':'未设置目标';
  $('receipt-wait').textContent='先等 '+(periodHours===168?'7 天':periodHours+' 小时')+'，再看这次心动。';
  $('receipt-dialog').showModal();
}
function drawReceipt(snapshot){
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
  const ink='#193e34',muted='#6d8574';ctx.fillStyle='#edf5ef';ctx.fillRect(0,0,1080,1350);
  ctx.fillStyle=ink;ctx.beginPath();ctx.arc(100,96,25,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(90,85,7,22);ctx.fillRect(103,85,7,22);
  const setFont=(size,weight=400)=>{ctx.font=`${weight} ${size}px "Microsoft YaHei","PingFang SC",sans-serif`;};
  const fit=(text,x,y,width,size=34,weight=400,color=ink)=>{setFont(size,weight);let adjusted=size;while(ctx.measureText(text).width>width&&adjusted>16)setFont(--adjusted,weight);ctx.fillStyle=color;ctx.fillText(text,x,y,width);};
  const wrap=(text,x,y,width,lineHeight,maxLines,size=40)=>{setFont(size,650);let line='',lines=[];for(const char of text){if(ctx.measureText(line+char).width>width){lines.push(line);line=char;}else line+=char;}if(line)lines.push(line);if(lines.length>maxLines){lines=lines.slice(0,maxLines);let last=lines[maxLines-1];while(ctx.measureText(last+'…').width>width)last=last.slice(0,-1);lines[maxLines-1]=last+'…';}ctx.fillStyle=ink;lines.forEach((item,index)=>ctx.fillText(item,x,y+lineHeight*index));};
  fit('慢半拍',140,111,350,39,700);fit('心动账单',80,202,920,59,750);
  const {data,result,plan,goal,goalName,periodHours}=snapshot;
  wrap(data.name,80,277,920,55,2,40);fit(yuan.format(data.price),80,438,920,91,750);
  ctx.strokeStyle='#b7cfbe';ctx.lineWidth=2;ctx.setLineDash([8,8]);ctx.beginPath();ctx.moveTo(80,484);ctx.lineTo(1000,484);ctx.stroke();ctx.setLineDash([]);
  const row=(label,value,y)=>{fit(label,80,y,920,27,400,muted);fit(value,80,y+52,920,38,650);};
  row('换成工作时间',decimal.format(result.workHours)+' 小时 · 约 '+decimal.format(result.workDays)+' 个工作日',555);
  row('预计使用 '+integer.format(data.uses)+' 次',yuan.format(result.perUse)+' / 次',693);
  row('达到我设定的单次成本',plan?integer.format(plan.neededUses)+' 次（每次不超过 '+yuan.format(plan.targetCost)+'）':'未设置',831);
  row(goal?'如果留给「'+goalName+'」':'另一种选择',goal?'相当于目标金额的 '+decimal.format(goal.contribution)+'%':'未设置目标',969);
  ctx.fillStyle=ink;ctx.beginPath();ctx.roundRect(80,1094,920,78,10);ctx.fill();fit('先等 '+(periodHours===168?'7 天':periodHours+' 小时')+'，再看这次心动。',112,1145,856,30,600,'#fff');
  fit('买不买，由你决定。',80,1240,920,27,400,muted);
  const date=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Shanghai'}).format(snapshot.createdAt);
  fit(date+' · 按填写数据试算 · 不展示收入数字',80,1292,920,21,400,muted);
  return canvas;
}
async function downloadReceipt(){
  if(!receiptSnapshot)return;
  const button=$('download-receipt');button.disabled=true;button.textContent='正在生成…';
  try{const canvas=drawReceipt(receiptSnapshot);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Export unavailable');const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='心动账单-'+receiptSnapshot.data.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').slice(0,30)+'.png';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('图片已生成，请在下载列表里查看。');}
  catch{toast('当前浏览器无法导出图片，可以复制文字或截取账单。');}
  finally{button.disabled=false;button.textContent='保存为图片';}
}
async function copyReceipt(){
  if(!receiptSnapshot)return;const text=receiptText(receiptSnapshot);
  try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else throw new Error('Clipboard unavailable');toast('心动账单已复制。');}
  catch{const input=document.createElement('textarea');input.value=text;input.style.cssText='position:fixed;top:0;left:0;opacity:0;width:1px;height:1px';$('receipt-dialog').append(input);input.select();let copied=false;try{copied=document.execCommand('copy');}catch{}input.remove();toast(copied?'心动账单已复制。':'当前浏览器不允许复制，请手动选择账单内容。');}
}
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function deleteIcon(){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS(ns,'path');path.setAttribute('d','M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7');svg.append(path);return svg;
}
function renderItem(item,now){
  const row=el('article','wish-item');row.dataset.id=item.id;
  const main=el('div','wish-main'),title=el('h3','',item.name),info=el('div','wish-info');
  info.append(el('span','wish-price',yuan.format(item.price)),el('span','',`约 ${decimal.format(item.workHours)} 小时工作 · 每次 ${yuan.format(item.perUse)}`));
  main.append(title,info);
  const savedReason=typeof item.reason==='string'?reasonNames[item.reason]:'';
  const savedUseCase=typeof item.useCase==='string'?item.useCase.slice(0,90):'';
  if(savedReason||savedUseCase)main.append(el('p','wish-reason',[savedReason,savedUseCase].filter(Boolean).join(' · ')));
  const timing=el('div','wish-timing');
  const status=el('span','wish-status '+item.status,item.status==='waiting'?(item.dueAt<=now?'可以复盘了':'冷静中'):item.status==='released'?'已决定 · 不买了':'已决定 · 仍然想买');
  timing.append(status);
  if(item.status==='waiting'){
    const countdown=el('strong','countdown',remainingLabel(item.dueAt,now));countdown.dataset.due=String(item.dueAt);timing.append(countdown);
    const track=el('div','wish-progress');const bar=el('span');bar.style.width=Math.max(0,Math.min(100,(now-item.createdAt)/(item.dueAt-item.createdAt)*100))+'%';track.append(bar);timing.append(track);
  }else timing.append(el('span','',`加入于 ${dateFormat.format(item.createdAt)}`));
  const actions=el('div','wish-actions');
  if(item.status==='waiting'){
    const review=el('button','secondary-button review-button',item.dueAt<=now?'再想一想':'提前想一想');review.type='button';review.dataset.action='review';review.setAttribute('aria-label',`${review.textContent}：${item.name}`);actions.append(review);
  }else{
    const reopen=el('button','secondary-button review-button','重新冷静');reopen.type='button';reopen.dataset.action='reopen';reopen.setAttribute('aria-label',`重新冷静：${item.name}`);actions.append(reopen);
  }
  const remove=el('button','icon-button');remove.type='button';remove.dataset.action='delete';remove.setAttribute('aria-label',`移除：${item.name}`);remove.title='移除记录';remove.append(deleteIcon());actions.append(remove);
  row.append(main,timing,actions);return row;
}
function renderList(){
  const waiting=records.filter(item=>item.status==='waiting'),decided=records.filter(item=>item.status!=='waiting');
  $('waiting-count').textContent=String(waiting.length);$('decided-count').textContent=String(decided.length);$('all-count').textContent=String(records.length);
  const visible=filter==='waiting'?waiting:filter==='decided'?decided:records;
  const sorted=[...visible].sort((a,b)=>(a.status==='waiting'?0:1)-(b.status==='waiting'?0:1)||(a.status==='waiting'?a.dueAt-b.dueAt:b.createdAt-a.createdAt));
  const fragment=document.createDocumentFragment(),now=Date.now();for(const item of sorted)fragment.append(renderItem(item,now));
  $('item-list').replaceChildren(fragment);$('empty-state').hidden=!!visible.length;
  $('empty-title').textContent=filter==='decided'?'还没有做出的决定':'清单还是空的，先给这次心动留个位置。';
  $('empty-description').textContent=filter==='decided'?'等心动慢下来，再记下你的选择。':'';
  $('list-summary').hidden=!records.length;$('summary-count').textContent=String(waiting.length);$('summary-money').textContent=yuan.format(waiting.reduce((sum,item)=>sum+item.price,0));
  for(const button of document.querySelectorAll('[data-filter]')){const selected=button.dataset.filter===filter;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
}
function changeFilter(next){filter=next;renderList();}
function refreshRecords(){if(storageAvailable)records=load();}
function openReview(id){
  refreshRecords();const item=records.find(record=>record.id===id);if(!item){renderList();return;}
  reviewId=id;$('review-product').textContent=`${item.name} · ${yuan.format(item.price)}`;
  const elapsed=Math.max(0,Date.now()-item.createdAt),hours=Math.floor(elapsed/3600000);
  const elapsedText=hours>=24?`${Math.floor(hours/24)} 天 ${hours%24} 小时`:hours?`${hours} 小时`:'不到 1 小时';
  $('review-time').textContent=`你已经给了自己 ${elapsedText}。${item.dueAt>Date.now()?'冷静期还没有结束，也可以先想一想。':'冷静期已经结束，现在可以重新看看。'}`;
  $('review-dialog').showModal();
}
function setDecision(status){
  refreshRecords();const item=records.find(record=>record.id===reviewId);if(!item){$('review-dialog').close();renderList();return;}
  item.status=status;item.decidedAt=Date.now();persist();$('review-dialog').close();changeFilter('decided');toast(status==='released'?'已记下：这次不买了。':'已记下：考虑过后，仍然想买。');
}
function reopen(id){
  refreshRecords();const item=records.find(record=>record.id===id);if(!item)return;
  item.status='waiting';item.createdAt=Date.now();item.dueAt=Date.now()+24*3600000;item.periodHours=24;delete item.decidedAt;persist();changeFilter('waiting');toast('又给自己留了 24 小时。');
}

for(const input of Object.values(fields))input.addEventListener('input',()=>updateCalculation());
$('use-range').addEventListener('input',()=>{fields.uses.value=$('use-range').value;updateCalculation();});
$('try-example').addEventListener('click',()=>{
  exampleIndex=(exampleIndex+1)%EXAMPLES.length;const example=EXAMPLES[exampleIndex];for(const [key,value]of Object.entries(example))fields[key].value=String(value);
  updateCalculation();toast('已填入试算示例，你可以直接修改。');
});
for(const button of document.querySelectorAll('[data-scene]')){
  button.addEventListener('click',()=>selectScene(button.dataset.scene));
  button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const scenes=['budget','time','usage','goal'];let index=scenes.indexOf(button.dataset.scene);if(event.key==='Home')index=0;else if(event.key==='End')index=scenes.length-1;else index=(index+(event.key==='ArrowRight'?1:scenes.length-1))%scenes.length;selectScene(scenes[index],true);});
}
for(const button of document.querySelectorAll('[data-uses]'))button.addEventListener('click',()=>{fields.uses.value=button.dataset.uses;updateCalculation();});
for(const id of ['target-cost','uses-week','goal-name','goal-total','goal-saved'])$(id).addEventListener('input',()=>updateScenarios(values(),calculate(values())));
for(const input of document.querySelectorAll('[name="reason"]'))input.addEventListener('change',()=>{$('reason-hint').textContent=reasonHints[input.value]||reasonHints.seed;});
$('generate-receipt').addEventListener('click',openReceipt);
$('download-receipt').addEventListener('click',downloadReceipt);
$('copy-receipt').addEventListener('click',copyReceipt);
form.addEventListener('submit',event=>{
  event.preventDefault();const data=values(),errors=validate(data,true);paintErrors(errors);
  if(Object.keys(errors).length){focusInvalid(Object.keys(errors)[0]);toast('先检查一下标出的输入项。');return;}
  refreshRecords();if(records.length>=MAX_ITEMS){toast('清单最多保留 100 条，先移除一些旧记录吧。');return;}
  const result=calculate(data),periodHours=Number(form.elements.cooldown.value),now=Date.now();
  const item={id:crypto.randomUUID(),name:data.name,price:data.price,workHours:result.workHours,perUse:result.perUse,status:'waiting',createdAt:now,dueAt:now+periodHours*3600000,periodHours,reason:form.elements.reason.value,useCase:$('use-case').value.trim()};
  records.unshift(item);persist();changeFilter('waiting');toast(storageAvailable?`已加入冷静清单，${periodHours===168?'7 天':periodHours+' 小时'}后再想一想。`:'已加入本次清单，但浏览器未能保存。');
  document.querySelectorAll('.reflection input').forEach(input=>input.checked=false);
  $('wishlist').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
});
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>changeFilter(button.dataset.filter));
$('item-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button)return;const row=button.closest('[data-id]');if(!row)return;const id=row.dataset.id;
  if(button.dataset.action==='review')openReview(id);
  else if(button.dataset.action==='reopen')reopen(id);
  else if(button.dataset.action==='delete'){
    refreshRecords();const index=records.findIndex(item=>item.id===id);if(index<0)return;const removed=records.splice(index,1)[0];persist();renderList();
    toast('已移除这条记录。',()=>{refreshRecords();if(!records.some(item=>item.id===removed.id)&&records.length<MAX_ITEMS)records.splice(Math.min(index,records.length),0,removed);persist();renderList();toast('记录已恢复。');});
  }
});
$('toast-undo').addEventListener('click',()=>{const action=undo;undo=null;if(action)action();});
$('open-method').addEventListener('click',()=>$('method-dialog').showModal());
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>$(button.dataset.close).close());
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
$('decide-release').addEventListener('click',()=>setDecision('released'));
$('decide-buy').addEventListener('click',()=>setDecision('wanted'));
$('wait-again').addEventListener('click',()=>{const id=reviewId;$('review-dialog').close();reopen(id);});
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY||event.key===null){records=load();renderList();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refreshRecords();renderList();}});
setInterval(()=>{
  if(document.visibilityState!=='visible')return;
  const now=Date.now();
  for(const row of $('item-list').querySelectorAll('.wish-item')){
    const item=records.find(record=>record.id===row.dataset.id);if(!item||item.status!=='waiting')continue;
    const countdown=row.querySelector('.countdown');if(countdown)countdown.textContent=remainingLabel(item.dueAt,now);
    const status=row.querySelector('.wish-status');if(status)status.textContent=item.dueAt<=now?'可以复盘了':'冷静中';
    const review=row.querySelector('[data-action="review"]');if(review){review.textContent=item.dueAt<=now?'再想一想':'提前想一想';review.setAttribute('aria-label',`${review.textContent}：${item.name}`);}
    const bar=row.querySelector('.wish-progress span');if(bar)bar.style.width=Math.max(0,Math.min(100,(now-item.createdAt)/(item.dueAt-item.createdAt)*100))+'%';
  }
},30000);

function updateBudget(data=values()){
 const payment=form.elements.payment.value,installment=payment==='installment';
 $('budget-installment').hidden=!installment;$('budget-installment-note').hidden=!installment;
 const map={cash:'budget-cash',expenses:'budget-expenses',debt:'budget-debt',reserveMonths:'budget-reserve',down:'budget-down',months:'budget-months',fee:'budget-fee'};
 const v={price:data.price,income:data.income,payment};
 for(const [key,id]of Object.entries(map))v[key]=['down','fee'].includes(key)&&$(id).value.trim()===''?0:numberValue(id);
 const quote=budgetPlan({...v,cash:0,expenses:0,debt:0,reserveMonths:0,income:0});
 $('budget-quote').hidden=!installment;
 $('budget-quote').textContent=quote?'每期约 '+yuan.format(quote.monthly)+' × '+v.months+' 期；首付 '+yuan.format(v.down)+'。':'填写有效的商品价格、1–120 期；首付不能超过商品价格，总费用不能小于 0。';
 const result=budgetPlan(v);
 for(const [key,id]of Object.entries(map)){
   const active=installment||!['down','months','fee'].includes(key);
   const valid=!active||(Number.isFinite(v[key])&&v[key]>=0&&v[key]<=1e8&&(key!=='reserveMonths'||Number.isInteger(v[key])&&v[key]<=120)&&(key!=='months'||Number.isInteger(v[key])&&v[key]>=1&&v[key]<=120)&&(key!=='down'||v[key]<=v.price));
   if(valid)$(id).removeAttribute('aria-invalid');else $(id).setAttribute('aria-invalid','true');
 }
 $('budget-error').textContent=result?'':'填写存款、必要开支和已有还款，没有填 0；预留月数为 0–120 的整数。分期请填写 1–120 期；首付和总费用留空按 0 计算，首付不能超过价格。请同时检查商品价格和收入。';
 $('budget-results').hidden=!result;if(!result)return;
 $('budget-cash-left').textContent=yuan.format(result.cashLeft);
 $('budget-protected').textContent=yuan.format(result.reserve);
 $('budget-payment-cost').textContent=installment?yuan.format(result.monthly)+'/月':'无';
 $('budget-monthly-left').textContent=yuan.format(result.monthlyLeft)+'/月';
 const verdict=result.upfrontShort?'现有存款不够支付'+(installment?'首付':'全款'):result.monthlyShort?'这笔消费后，每月收支会有缺口':result.reserveShort?'付得出，但会动用你预留的钱':result.monthlyLeft===0?'每月结余将为 0':'按这些数字，付款后仍有余量';
 $('budget-verdict').textContent=verdict;
 const details=[];
 if(result.upfrontShort)details.push('当前付款还差 '+yuan.format(-result.cashLeft)+'，未假设额外借款。');
 if(result.reserveShort)details.push('付款后比你设定的预留金额少 '+yuan.format(result.reserve-result.cashLeft)+'。');
 if(result.monthlyShort)details.push('每月缺口 '+yuan.format(-result.monthlyLeft)+'，需由其他资金补足。');
 if(!details.length)details.push('这只是当前数字下的余额，不代表未来收入和支出不会变化。');
 $('budget-detail').textContent=details.join('');
 $('budget-saving').textContent=result.gap===0?'在保留你设定的预留金额后，现有存款已能覆盖全款。':result.savingMonths===null?'保留预留金额后，全款还差 '+yuan.format(result.gap)+'；购买前每月结余不大于 0，暂时无法推算攒够日期。':'如果先攒钱再全款：保留预留金额后还差 '+yuan.format(result.gap)+'，按购买前每月结余 '+yuan.format(result.base)+'，约需 '+integer.format(result.savingMonths)+' 个月。';
 $('budget-future').textContent=installment?(result.financed>0?'其中 '+yuan.format(result.financed)+' 商品本金延后支付；':'商品本金已由首付覆盖；')+'月供占用未来 '+v.months+' 个月的现金流。分期本身不直接等于负担过重。':'全款是否宽裕，仍要结合预留资金和每月结余一起看。';
}
for(const id of ['budget-cash','budget-expenses','budget-debt','budget-reserve','budget-down','budget-months','budget-fee'])$(id).addEventListener('input',()=>updateBudget());
for(const radio of document.querySelectorAll('[name="payment"]'))radio.addEventListener('change',()=>updateBudget());
$('budget-example').addEventListener('click',()=>{
 fields.name.value='苹果手机';fields.price.value='16999';fields.income.value='6000';
 $('budget-cash').value='0';$('budget-expenses').value='5000';$('budget-debt').value='0';$('budget-reserve').value='3';
 $('budget-down').value='0';$('budget-months').value='12';$('budget-fee').value='0';
 form.elements.payment.value='installment';updateCalculation();selectScene('budget');toast('已填入假设示例：存款 0、生活开支 5000、12 期零费用。请改成真实情况。');
});

records=load();updateCalculation(false);renderList();
initSmallPurchases({toast});


})();
