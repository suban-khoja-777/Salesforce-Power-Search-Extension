import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {initAdmin} from '../app/admin.js';
import {sampleAdminMessage} from '../app/admin-sample.js';
const dom=new JSDOM('<section id="record"></section><section id="settings"></section>');globalThis.document=dom.window.document;
const record=document.querySelector('#record'),settings=document.querySelector('#settings'),messages=[];
const admin=initAdmin({recordRoot:record,settingsRoot:settings,send:async message=>{messages.push(message);return sampleAdminMessage(message);}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));const button=text=>[...record.querySelectorAll('button')].find(b=>b.textContent.startsWith(text));
test('record fields search labels, API names and values; multiple edits save only changed fields',async()=>{
 admin.record.open();await tick();assert.equal(record.querySelectorAll('tbody tr').length,6);const filter=record.querySelector('input[type=search]');
 for(const term of ['Account Name','AnnualRevenue','Acme']){filter.value=term;filter.dispatchEvent(new dom.window.Event('input'));assert.equal(record.querySelectorAll('tbody tr').length,1);}
 filter.value='';filter.dispatchEvent(new dom.window.Event('input'));const name=record.querySelector('[aria-label="Edit Account Name (Name)"]'),revenue=record.querySelector('[aria-label="Edit Annual Revenue (AnnualRevenue)"]');
 name.value='Updated account';name.dispatchEvent(new dom.window.Event('input'));revenue.value='500';revenue.dispatchEvent(new dom.window.Event('input'));assert.match(button('Save').textContent,/2 changed/);assert.equal(button('Reload').disabled,true);
 button('Save').click();await tick();assert.deepEqual(messages.find(m=>m.type==='RECORD_SAVE').changes,{Name:'Updated account',AnnualRevenue:500});assert.match(record.textContent,/Changes saved/);assert.match(record.textContent,/Updated account/);
});
test('changing page context clears stale record and drafts',async()=>{
 admin.setContext(null);admin.setContext({objectName:'Account',id:'001000000000002AAA'});await tick();admin.setContext(null);assert.equal(record.querySelectorAll('tbody tr').length,0);assert.equal(button('Save').disabled,true);
});
test('settings expose configurable categories and explicit enable action',async()=>{
 await admin.settings.open();assert.equal(settings.querySelectorAll('select').length,9);const duration=settings.querySelector('select');duration.value='60';settings.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();assert.equal(messages.find(m=>m.type==='DEBUG_SETTINGS_SAVE').settings.minutes,60);
 [...settings.querySelectorAll('button')].find(b=>b.textContent==='Enable debug logs for me').click();await tick();assert.ok(messages.some(m=>m.type==='DEBUG_ENABLE'));assert.match(settings.textContent,/Preview only/);
});
