import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {initQueryWorkspace} from '../app/query.js';
import {sampleQueryMessage} from '../app/query-sample.js';
const dom=new JSDOM(await readFile(new URL('../app/palette.html',import.meta.url),'utf8'),{url:'http://localhost/app/palette.html'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,Option:dom.window.Option});
let copied='',downloaded;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>{copied=value;}}}});URL.createObjectURL=blob=>{downloaded=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){};
const $=selector=>document.querySelector(selector),tick=()=>new Promise(resolve=>setImmediate(resolve));
const messages=[];let failDelete=false;
const workspace=initQueryWorkspace({root:$('#query-workspace'),send:async message=>{messages.push(message);if(failDelete&&message.type==='QUERY_DELETE')return {ok:true,results:[{id:'001000000000001AAA',success:true},{id:'001000000000002AAA',success:false,error:'DELETE_FAILED'}]};return sampleQueryMessage(message);}});
const change=(selector,value,event='input')=>{$(selector).value=value;$(selector).dispatchEvent(new dom.window.Event(event));};
test('object picker generates query, suggests fields, runs searchable records and copies/exports',async()=>{
 await workspace.open();assert.equal($('#query-object').options.length,3);change('#query-object','Account','change');await tick();assert.equal($('#query-editor').value,'SELECT Id FROM Account');
 change('#query-editor','SELECT Id, Na FROM Account');$('#query-editor').setSelectionRange(13,13);$('#query-editor').dispatchEvent(new dom.window.Event('input'));assert.equal($('#field-suggestions').hidden,false);$('#field-suggestions button').click();assert.equal($('#query-editor').value,'SELECT Id, Name FROM Account');
 $('#query-run').click();await tick();assert.equal($('#query-body').children.length,2);const link=$('#query-body a');assert.equal(link.target,'_blank');assert.match(link.href,/\/lightning\/r\/Account\/001/);
 const buttons=[...$('#query-body').querySelectorAll('button')];buttons.find(button=>button.getAttribute('aria-label').startsWith('Copy Name')).click();await tick();assert.equal(copied,'Acme');
 change('#result-search','Northwind');assert.equal($('#query-body').children.length,1);[...$('#query-head').querySelectorAll('button')].find(b=>b.getAttribute('aria-label').startsWith('Copy Name')).click();await tick();assert.equal(copied,'Northwind');$('#query-export').click();const csv=await downloaded.text();assert.match(csv,/Northwind/);assert.doesNotMatch(csv,/Acme/);
});
test('selected rows survive filters, delete review binds IDs and reports partial failures',async()=>{
 change('#result-search','');$('#query-head input').click();assert.equal(workspace.state.selected.size,2);change('#result-search','Acme');$('#query-delete').click();await tick();assert.equal($('#delete-review').hidden,false);assert.match($('#delete-summary').textContent,/2 selected Account/);assert.equal($('#confirm-delete').disabled,true);assert.equal(messages.filter(m=>m.type==='QUERY_DELETE').length,0);
 change('#delete-word','DELETE');assert.equal($('#confirm-delete').disabled,false);failDelete=true;$('#confirm-delete').click();await tick();assert.equal(workspace.state.rows.length,1);assert.equal(workspace.state.selected.size,1);assert.match($('#delete-errors').textContent,/DELETE_FAILED/);assert.equal($('#query-more').disabled,true);assert.match($('#query-status').textContent,/1 deleted; 1 failed/);
 change('#query-object','Contact','change');await tick();assert.equal($('#query-editor').value,'SELECT Id FROM Contact');assert.equal(workspace.state.selected.size,0);assert.equal($('#delete-errors').textContent,'');
});

test('object API typing displays matches directly and Enter selects the object',async()=>{
 change('#query-object-filter','acc');assert.equal($('#object-suggestions').hidden,false);assert.equal($('#object-suggestions').children.length,1);assert.match($('#object-suggestions').textContent,/Account/);
 $('#query-object-filter').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();assert.equal($('#query-editor').value,'SELECT Id FROM Account');assert.equal($('#object-suggestions').hidden,true);
 change('#query-object-filter','no_such_object');assert.match($('#object-suggestions').textContent,/No matching objects/);$('#query-object-filter').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal($('#object-suggestions').hidden,true);
});
test('field badges and searchable all-fields browser insert fields without duplicate SELECT values',()=>{
 $('#view-all-fields').click();assert.equal($('#all-fields').hidden,false);assert.equal($('#all-fields button').className,'field-badge');change('#field-filter','Revenue');assert.equal($('#all-fields').children.length,1);$('#all-fields button').click();assert.equal($('#query-editor').value,'SELECT Id, AnnualRevenue FROM Account');$('#all-fields button').click();assert.equal($('#query-editor').value,'SELECT Id, AnnualRevenue FROM Account');
 change('#query-editor','SELECT Id, Na FROM Account');$('#query-editor').setSelectionRange(13,13);$('#query-editor').dispatchEvent(new dom.window.Event('input'));assert.equal($('#field-suggestions button').className,'field-badge');assert.equal($('#field-suggestions button').textContent,'Name');$('#field-suggestions button').click();assert.equal($('#query-editor').value,'SELECT Id, Name FROM Account');
 $('#view-all-fields').click();assert.equal($('#all-fields').hidden,true);
});

test('WHERE value badges replace field suggestions and support click and keyboard selection',()=>{
 change('#query-editor','SELECT Id FROM Account WHERE Industry');$('#query-editor').setSelectionRange($('#query-editor').value.length,$('#query-editor').value.length);$('#query-editor').dispatchEvent(new dom.window.Event('input'));assert.deepEqual([...$('#field-suggestions').children].map(node=>node.textContent),['Technology','Retail','Other']);$('#field-suggestions button').click();assert.equal($('#query-editor').value,"SELECT Id FROM Account WHERE Industry = 'Technology'");
 change('#query-editor','SELECT Id FROM Account WHERE IsDeleted = ');$('#query-editor').dispatchEvent(new dom.window.Event('input'));assert.deepEqual([...$('#field-suggestions').children].map(node=>node.textContent),['true','false']);$('#query-editor').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));$('#query-editor').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal($('#query-editor').value,'SELECT Id FROM Account WHERE IsDeleted = false');
 change('#query-editor','SELECT Id FROM Account WHERE Name = ');$('#query-editor').dispatchEvent(new dom.window.Event('input'));assert.equal($('#field-suggestions button').textContent,'null');$('#field-suggestions button').click();assert.equal($('#query-editor').value,'SELECT Id FROM Account WHERE Name = null');
});

test('Load all batches DOM rendering while preserving columns from later pages',async()=>{
 const panel=document.createElement('section');
 // Use a fresh copy of the real workspace markup, independent of previous result selections.
 const parsed=new JSDOM(await readFile(new URL('../app/palette.html',import.meta.url),'utf8'));panel.replaceChildren(document.importNode(parsed.window.document.querySelector('#query-workspace'),true));const root=panel.firstChild;document.body.append(panel);
 let page=0;const q=initQueryWorkspace({root,send:async message=>{
  if(message.type==='QUERY_RUN'||message.type==='QUERY_MORE'){page++;return {ok:true,queryId:'pages',total:3,done:page===3,records:[{Id:`00100000000000${page}AAA`,Name:`Row ${page}`,...(page===3?{Later:'last'}:{})}],selectableIds:[],orgOrigin:'https://acme.lightning.force.com',orgLabel:'Acme'};}
  return sampleQueryMessage(message);
 }});await q.open();await q.restore({objectName:'Account',query:'SELECT Id, Name FROM Account'});await root.querySelector('#query-run').onclick();
 let redraws=0;const body=root.querySelector('#query-body'),replace=body.replaceChildren.bind(body);body.replaceChildren=(...nodes)=>{redraws++;replace(...nodes);};
 await root.querySelector('#query-all').onclick();assert.equal(q.state.rows.length,3);assert.ok(q.state.columns.includes('Later'));assert.equal(body.children.length,3);assert.equal(redraws,2,'one busy-state render and one final render, independent of page count');panel.remove();
});
