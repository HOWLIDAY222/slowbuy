export const STORAGE_KEY = 'slowbuy.items.v1';
export const MAX_ITEMS = 100;
export const EXAMPLES = [
  {name:'降噪耳机',price:1299,income:8000,days:22,hours:8,uses:100},
  {name:'周末咖啡机',price:2699,income:10000,days:22,hours:8,uses:300},
  {name:'一双新球鞋',price:899,income:6000,days:22,hours:8,uses:80}
];
export function validate(values, requireName=false) {
  const errors = {};
  if(requireName && !String(values.name||'').trim()) errors.name='给这次心动取个名字。';
  if(!Number.isFinite(values.price)||values.price<0.01||values.price>1e8) errors.price='填写 0.01 元至 1 亿元的价格。';
  if(!Number.isFinite(values.income)||values.income<0.01||values.income>1e8) errors.income='填写 0.01 元至 1 亿元的每月到手收入。';
  if(!Number.isInteger(values.days)||values.days<1||values.days>31) errors.days='填写 1–31 的整数。';
  if(!Number.isFinite(values.hours)||values.hours<0.1||values.hours>24) errors.hours='填写 0.1–24 小时。';
  if(!Number.isInteger(values.uses)||values.uses<1||values.uses>10000) errors.uses='填写 1–10000 的整数。';
  return errors;
}
export function calculate(values) {
  if(Object.keys(validate(values)).length) return null;
  const hourlyIncome=values.income/(values.days*values.hours);
  const workHours=values.price/hourlyIncome;
  return {hourlyIncome,workHours,workDays:workHours/values.hours,perUse:values.price/values.uses,incomeShare:values.price/values.income*100};
}
export function usagePlan(price,targetCost,weeklyUses) {
  if(!Number.isFinite(price)||price<0.01||price>1e8||!Number.isFinite(targetCost)||targetCost<0.01||targetCost>1e8||!Number.isFinite(weeklyUses)||weeklyUses<0.1||weeklyUses>1000)return null;
  const ratio=price/targetCost;
  const neededUses=Math.max(1,Math.ceil(ratio-Number.EPSILON*ratio*2));
  const weeks=neededUses/weeklyUses;
  return {neededUses,neededWeeks:Math.max(1,Math.ceil(weeks-Number.EPSILON*weeks*2)),targetCost,weeklyUses};
}
export function goalComparison(price,goalTotal,goalSaved) {
  if(!Number.isFinite(price)||price<0.01||price>1e8||!Number.isFinite(goalTotal)||goalTotal<0.01||goalTotal>1e8||!Number.isFinite(goalSaved)||goalSaved<0||goalSaved>1e8)return null;
  const before=Math.min(100,goalSaved/goalTotal*100);
  const after=Math.min(100,(goalSaved+price)/goalTotal*100);
  return {contribution:price/goalTotal*100,before,after,extra:Math.max(0,after-before),remaining:Math.max(0,goalTotal-goalSaved-price)};
}
export function validRecord(item) {
  return item && typeof item==='object' && typeof item.id==='string' && item.id.length<100 && typeof item.name==='string' && item.name.trim().length>0 && item.name.length<=60 && ['waiting','released','wanted'].includes(item.status) && ['price','workHours','perUse','createdAt','dueAt','periodHours'].every(key=>Number.isFinite(item[key])&&item[key]>0) && item.price<=1e8 && item.dueAt<=8.64e15 && item.createdAt<=item.dueAt && [24,72,168].includes(item.periodHours);
}
export function decodeRecords(raw) {
  if(raw===null) return {items:[],malformed:false};
  try {
    const data=JSON.parse(raw);
    if(data.version!==1||!Array.isArray(data.items)) return {items:[],malformed:true};
    const filtered=data.items.filter(validRecord).slice(0,MAX_ITEMS);
    const unique=filtered.filter((item,index,arr)=>arr.findIndex(other=>other.id===item.id)===index);
    return {items:unique,malformed:unique.length!==data.items.length};
  } catch { return {items:[],malformed:true}; }
}
export function remainingLabel(dueAt, now=Date.now()) {
  const ms=dueAt-now;
  if(ms<=0) return '冷静期已到，可以再想一想';
  const minutes=Math.max(1,Math.ceil(ms/60000));
  const days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),mins=minutes%60;
  if(days) return `还剩 ${days} 天${hours ? ` ${hours} 小时` : ''}`;
  if(hours) return `还剩 ${hours} 小时${mins ? ` ${mins} 分钟` : ''}`;
  return `还剩 ${mins} 分钟`;
}


// Monetary arithmetic uses cents so boundary decisions do not depend on float noise.
export function budgetPlan(v) {
  const keys=['price','income','cash','expenses','debt','reserveMonths'];
  if(keys.some(k=>!Number.isFinite(v[k])||v[k]<0||v[k]>1e8)||v.price<0.01||!Number.isInteger(v.reserveMonths)||v.reserveMonths>120||!['cash','installment'].includes(v.payment))return null;
  const cents=n=>Math.round(n*100);
  const price=cents(v.price),income=cents(v.income),cash=cents(v.cash),expenses=cents(v.expenses),debt=cents(v.debt);
  const installment=v.payment==='installment';
  if(installment&&(!Number.isFinite(v.down)||v.down<0||cents(v.down)>price||!Number.isFinite(v.fee)||v.fee<0||v.fee>1e8||!Number.isInteger(v.months)||v.months<1||v.months>120))return null;
  const upfront=installment?cents(v.down):price,financed=price-upfront;
  const monthly=installment?(financed+cents(v.fee))/v.months:0;
  const base=income-expenses-debt,reserve=(expenses+debt)*v.reserveMonths;
  const cashLeft=cash-upfront,available=Math.max(0,cash-reserve),gap=Math.max(0,price-available),monthlyLeft=base-monthly;
  return {cashLeft:cashLeft/100,reserve:reserve/100,monthly:monthly/100,monthlyLeft:monthlyLeft/100,base:base/100,financed:financed/100,gap:gap/100,savingMonths:gap===0?0:base>0?Math.ceil(gap/base):null,upfrontShort:cashLeft<0,reserveShort:cashLeft<reserve,monthlyShort:monthlyLeft<0,installment};
}
