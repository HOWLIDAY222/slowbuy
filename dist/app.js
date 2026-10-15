import {STORAGE_KEY,MAX_ITEMS,EXAMPLES,validate,calculate,usagePlan,goalComparison,decodeRecords,remainingLabel} from './core.mjs';

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
  button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const scenes=['time','usage','goal'];let index=scenes.indexOf(button.dataset.scene);if(event.key==='Home')index=0;else if(event.key==='End')index=2;else index=(index+(event.key==='ArrowRight'?1:2))%3;selectScene(scenes[index],true);});
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
records=load();updateCalculation(false);renderList();
