// Lightweight DOM harness: checks event wiring/state without a browser renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initSmallPurchases} from '../dist/small-ui.mjs';
import {SMALL_KEY} from '../dist/small.mjs';

function harness(saved=new Map(),failWrite=false){
  const elements=new Map(),tools=[],links=[];let active=null;
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.value='';this.hidden=false;this.checked=false;this.listeners={};this.attributes={};this.classList={toggle(){}};}
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
  for(const id of html.matchAll(/id="([^"]+)"/g))elements.set(id[1],new Element());
  for(const mode of ['single','small','night']){const e=new Element('button');e.dataset.tool=mode;tools.push(e);}
  for(let i=0;i<2;i++)links.push(new Element('a'));
  const doc={getElementById:id=>elements.get(id),querySelectorAll:s=>s==='[data-tool]'?tools:links,createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment'),addEventListener(){},visibilityState:'visible',get activeElement(){return active;}};
  elements.get('small-form').reset=()=>{elements.get('small-name').value='';elements.get('small-price').value='';};elements.get('small-frequency').value='8';
  globalThis.document=doc;globalThis.window={addEventListener(){}};
  globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem(k,v){if(failWrite)throw Error('quota');saved.set(k,v);}};
  const original=globalThis.setInterval;globalThis.setInterval=()=>0;
  const messages=[];try{initSmallPurchases({toast:(...args)=>messages.push(args)});}finally{globalThis.setInterval=original;}
  return {get:id=>elements.get(id),tools,saved,messages,add(name,price,bought=false){elements.get('small-name').value=name;elements.get('small-price').value=String(price);if(bought)elements.get('small-add-bought').fire('click');else elements.get('small-form').fire('submit');},records:()=>JSON.parse(saved.get(SMALL_KEY)).items};
}

test('capture, totals, review, undo, persisted reload and bedtime mode',()=>{
  const h=harness();h.tools[1].fire('click');assert.equal(h.get('small-tool').hidden,false);assert.equal(h.get('single-tool').hidden,true);
  h.add('T 恤',39);h.add('杯子',59,true);h.add('耳饰',89);
  assert.equal(h.records().length,3);assert.match(h.get('small-today-planned').textContent,/128\.00/);assert.match(h.get('small-today-bought').textContent,/59\.00/);assert.match(h.get('small-projection-text').textContent,/1,496\.00/);
  const list=h.get('small-list'),row=list.children.find(r=>r.dataset.smallId===h.records().find(i=>i.name==='T 恤').id);
  const review=row.querySelector('[data-small-action="review"]');list.fire('click',{target:review});assert.equal(h.get('small-review-dialog').open,true);
  h.get('small-bought').fire('click');assert.match(h.get('small-today-bought').textContent,/98\.00/);assert.match(h.get('small-today-planned').textContent,/89\.00/);
  const remove=h.get('small-list').children[0].querySelector('[data-small-action="delete"]');h.get('small-list').fire('click',{target:remove});assert.equal(h.records().length,2);h.messages.at(-1)[1]();assert.equal(h.records().length,3);
  const reloaded=harness(h.saved);assert.match(reloaded.get('small-month-bought').textContent,/98\.00/);
  reloaded.tools[2].fire('click');assert.equal(reloaded.get('small-add-bought').hidden,true);reloaded.add('明早看看',19.9);const nightItem=reloaded.records()[0];assert.equal(nightItem.status,'planned');assert.ok(nightItem.reviewAt>Date.now());assert.equal(new Date(nightItem.reviewAt).getHours(),9);
});

test('invalid prices do not write and storage failures preserve in-memory records',()=>{
  const h=harness();h.add('错误',0);assert.equal(h.saved.has(SMALL_KEY),false);h.add('错误',1.001);assert.equal(h.saved.has(SMALL_KEY),false);
  const failure=harness(new Map(),true);failure.add('A',10);failure.add('B',20);assert.match(failure.get('small-today-planned').textContent,/30\.00/);assert.equal(failure.get('small-storage-warning').hidden,false);
});

test('stale review cannot overwrite a purchase confirmed in another tab',()=>{
  const h=harness();h.add('跨页测试',39);
  h.get('small-list').fire('click',{target:h.get('small-list').children[0].querySelector('[data-small-action="review"]')});
  const stored=h.records();stored[0].status='bought';stored[0].decidedAt=Date.now();h.saved.set(SMALL_KEY,JSON.stringify({version:1,items:stored}));
  h.get('small-release').fire('click');assert.equal(h.records()[0].status,'bought');assert.equal(h.get('small-review-dialog').open,false);assert.match(h.messages.at(-1)[0],/其他页面更新/);
});
