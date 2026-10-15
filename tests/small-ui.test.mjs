// Lightweight DOM harness: checks event wiring/state without a browser renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initSmallPurchases} from '../dist/small-ui.mjs';
import {SMALL_KEY} from '../dist/small.mjs';

function harness(saved=new Map(),failWrite=false){
  const elements=new Map(),tools=[],links=[];let active=null;
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.value='';this.hidden=false;this.checked=false;this.open=false;this.listeners={};this.attributes={};this.classList={toggle(){}};}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    fire(type,extra={}){for(const fn of this.listeners[type]||[])fn({target:this,preventDefault(){},...extra});}
    setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
    append(...children){for(const child of children){if(child.tagName==='fragment')this.append(...child.children);else{child.parent=this;this.children.push(child);}}}
    replaceChildren(...children){this.children=[];this.append(...children);}
    focus(){active=this;}showModal(){this.open=true;}close(){this.open=false;}
    closest(selector){if(selector==='[data-small-action]'&&this.dataset.smallAction)return this;if(selector==='[data-small-id]'&&this.dataset.smallId)return this;return this.parent?.closest(selector)||null;}
    querySelector(selector){const action=selector.match(/data-small-action="([^"]+)"/)?.[1];return this.children.find(c=>c.dataset.smallAction===action)||this.children.map(c=>c.querySelector(selector)).find(Boolean)||null;}
  }
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){
    const element=new Element(match[1]),attributes=match[2];
    element.value=attributes.match(/\bvalue="([^"]*)"/)?.[1]||'';
    element.hidden=/\bhidden(?:\s|=|$)/.test(attributes);
    element.checked=/\bchecked(?:\s|=|$)/.test(attributes);
    element.open=/\bopen(?:\s|=|$)/.test(attributes);
    elements.set(match[3],element);
  }
  for(const mode of ['single','small','night']){const e=new Element('button');e.dataset.tool=mode;tools.push(e);}
  for(let i=0;i<2;i++)links.push(new Element('a'));
  const doc={getElementById:id=>elements.get(id),querySelectorAll:s=>s==='[data-tool]'?tools:links,createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment'),addEventListener(){},visibilityState:'visible',get activeElement(){return active;}};
  elements.get('small-form').reset=()=>{elements.get('small-name').value='';elements.get('small-price').value='';};
  globalThis.document=doc;globalThis.window={addEventListener(){}};
  globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem(k,v){if(failWrite)throw Error('quota');saved.set(k,v);}};
  const original=globalThis.setInterval;globalThis.setInterval=()=>0;
  const messages=[];try{initSmallPurchases({toast:(...args)=>messages.push(args)});}finally{globalThis.setInterval=original;}
  const records=()=>JSON.parse(saved.get(SMALL_KEY)||'{"items":[]}').items;
  const button=(name,action)=>{const id=records().find(item=>item.name===name)?.id;const row=elements.get('small-list').children.find(item=>item.dataset.smallId===id);return row?.querySelector(`[data-small-action="${action}"]`);};
  return {get:id=>elements.get(id),tools,saved,messages,button,action(name,action){const target=button(name,action);assert.ok(target,`${name} exposes ${action}`);elements.get('small-list').fire('click',{target});},add(name,price,bought=false){elements.get('small-name').value=name;elements.get('small-price').value=String(price);if(bought)elements.get('small-add-bought').fire('click');else elements.get('small-form').fire('submit');},records};
}

test('capture, direct decisions, undo, persisted reload and bedtime mode',()=>{
  const h=harness();h.tools[1].fire('click');assert.equal(h.get('small-tool').hidden,false);assert.equal(h.get('single-tool').hidden,true);
  h.add('T 恤',39);h.add('杯子',59,true);h.add('耳饰',89);
  assert.equal(h.records().length,3);assert.match(h.get('small-today-planned').textContent,/128\.00/);assert.match(h.get('small-today-bought').textContent,/59\.00/);
  assert.match(h.get('small-reality').textContent,/已买 1 笔，共.*59\.00/);assert.match(h.get('small-reality').textContent,/2 笔待买共.*128\.00/);assert.match(h.get('small-reality').textContent,/如果都买下.*187\.00/);
  for(const action of ['later','bought','released','delete'])assert.ok(h.button('T 恤',action));
  assert.equal(h.button('T 恤','review'),null);assert.equal(h.get('small-review-dialog'),undefined);
  h.action('T 恤','bought');assert.match(h.get('small-today-bought').textContent,/98\.00/);assert.match(h.get('small-today-planned').textContent,/89\.00/);assert.match(h.get('small-reality').textContent,/如果都买下.*187\.00/);
  h.action('耳饰','released');assert.match(h.get('small-today-bought').textContent,/98\.00/);assert.match(h.get('small-today-planned').textContent,/0\.00/);assert.equal(h.records().find(item=>item.name==='耳饰').status,'released');
  h.messages.at(-1)[1]();assert.equal(h.records().find(item=>item.name==='耳饰').status,'planned');assert.match(h.get('small-today-planned').textContent,/89\.00/);
  h.action('耳饰','delete');assert.equal(h.records().length,2);h.messages.at(-1)[1]();assert.equal(h.records().length,3);
  const reloaded=harness(h.saved);assert.match(reloaded.get('small-month-bought').textContent,/98\.00/);
  reloaded.tools[2].fire('click');assert.equal(reloaded.get('small-add-bought').hidden,true);reloaded.add('明早看看',19.9);const nightItem=reloaded.records()[0];assert.equal(nightItem.status,'planned');assert.ok(nightItem.reviewAt>Date.now());assert.equal(new Date(nightItem.reviewAt).getHours(),9);
});

test('repetition projection is optional, closed and has no invented default frequency',()=>{
  const h=harness();h.add('T 恤',39);h.add('杯子',59,true);h.add('耳饰',89);
  assert.equal(h.get('small-frequency').value,'');assert.equal(h.get('small-projection-details').open,false);
  assert.equal(h.get('small-frequency').attributes['aria-invalid'],'false');
  assert.doesNotMatch(h.get('small-projection-text').textContent,/1,496|8 次|\d+\.\d{2}/);
  h.get('small-frequency').value='8';h.get('small-frequency').fire('input');
  assert.match(h.get('small-projection-text').textContent,/仅作假设/);assert.match(h.get('small-projection-text').textContent,/1,496\.00/);assert.match(h.get('small-projection-text').textContent,/不是本月实际支出/);
  assert.match(h.get('small-month-bought').textContent,/59\.00/);assert.match(h.get('small-today-bought').textContent,/59\.00/);
  h.get('small-frequency').value='0';h.get('small-frequency').fire('input');assert.equal(h.get('small-frequency').attributes['aria-invalid'],'true');
  h.get('small-frequency').value='';h.get('small-frequency').fire('input');assert.equal(h.get('small-frequency').attributes['aria-invalid'],'false');assert.doesNotMatch(h.get('small-projection-text').textContent,/1,496/);
});

test('postponement uses tomorrow at nine even before nine and does not alter actual spending',()=>{
  const RealDate=Date,fixed=new RealDate(2026,9,15,2,30).getTime();
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
  try{
    const h=harness();h.add('已经花的',59,true);h.add('留到明天',39);
    const before={...h.records().find(item=>item.name==='留到明天')};
    h.action('留到明天','later');const postponed=h.records().find(item=>item.id===before.id);
    assert.equal(postponed.reviewAt,new RealDate(2026,9,16,9).getTime());assert.equal(postponed.status,'planned');assert.equal(postponed.createdAt,before.createdAt);assert.equal(postponed.decidedAt,undefined);
    assert.match(h.get('small-today-bought').textContent,/59\.00/);assert.match(h.get('small-month-bought').textContent,/59\.00/);assert.match(h.get('small-today-planned').textContent,/39\.00/);
    assert.match(h.get('small-reality').textContent,/如果都买下.*98\.00/);
    h.messages.at(-1)[1]();assert.deepEqual(h.records().find(item=>item.id===before.id),before);
    h.tools[2].fire('click');h.add('睡前先记下',10);assert.equal(h.records()[0].reviewAt,new RealDate(2026,9,15,9).getTime());
  }finally{globalThis.Date=RealDate;}
});

test('invalid prices do not write and storage failures preserve in-memory records',()=>{
  const h=harness();h.add('错误',0);assert.equal(h.saved.has(SMALL_KEY),false);h.add('错误',1.001);assert.equal(h.saved.has(SMALL_KEY),false);
  const failure=harness(new Map(),true);failure.add('A',10);failure.add('B',20);assert.match(failure.get('small-today-planned').textContent,/30\.00/);assert.equal(failure.get('small-storage-warning').hidden,false);
});

test('stale direct actions cannot overwrite a purchase confirmed in another tab',()=>{
  for(const action of ['later','bought','released']){
    const h=harness();h.add('跨页测试',39);const stale=h.button('跨页测试',action);
    const stored=h.records();stored[0].status='bought';stored[0].decidedAt=Date.now()-1000;const confirmed={...stored[0]};h.saved.set(SMALL_KEY,JSON.stringify({version:1,items:stored}));
    h.get('small-list').fire('click',{target:stale});assert.deepEqual(h.records()[0],confirmed);assert.match(h.messages.at(-1)[0],/其他页面更新/);
  }
});

test('decision undo does not overwrite a newer state from another tab',()=>{
  const h=harness();h.add('不覆盖新状态',39);h.action('不覆盖新状态','released');const undo=h.messages.at(-1)[1];
  const stored=h.records();stored[0].status='bought';stored[0].decidedAt=Date.now()+1;const confirmed={...stored[0]};h.saved.set(SMALL_KEY,JSON.stringify({version:1,items:stored}));
  undo();assert.deepEqual(h.records()[0],confirmed);assert.match(h.messages.at(-1)[0],/无法撤销/);
});
