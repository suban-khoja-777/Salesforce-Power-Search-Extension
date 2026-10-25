import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {initQueryDesk} from '../app/query-desk.js';
import {sampleQueryMessage} from '../app/query-sample.js';
const dom=new JSDOM(await readFile(new URL('../app/palette.html',import.meta.url),'utf8'),{url:'http://localhost'});Object.assign(globalThis,{document:dom.window.document,window:dom.window,Option:dom.window.Option});
const deskMessages=[];
const root=document.querySelector('#query-workspace');root.hidden=false;const desk=initQueryDesk({root,send:async message=>{deskMessages.push(message);return sampleQueryMessage(message);},isPreview:true});const tick=()=>new Promise(resolve=>setImmediate(resolve));
const button=name=>[...root.querySelectorAll('button')].find(node=>node.textContent===name);
const type=(input,value)=>{input.value=value;input.dispatchEvent(new dom.window.Event('input'));};
test('editor-first object selection, separate query tabs and recoverable tab close',async()=>{
 desk.open();await tick();assert.equal(document.activeElement,desk.editor);type(desk.editor,'Acc');assert.match(root.querySelector('[id^=field-suggestions]').textContent,/Account/);desk.editor.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();assert.equal(desk.editor.value,'SELECT Id FROM Account');
 type(desk.editor,'SELECT Id, Name FROM Account');button('Run query').click();await tick();assert.equal(desk.state.rows.length,2);const first=desk.sessions[0];first.root.querySelector('#query-body input').click();assert.equal(desk.state.selected.size,1);
 button('+ Query').click();await tick();const second=desk.sessions[1];assert.equal(desk.editor.value,'');type(desk.editor,'Contact');desk.editor.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();assert.equal(desk.editor.value,'SELECT Id FROM Contact');assert.equal(desk.state.rows.length,0);
 document.querySelector(`[aria-controls="${first.root.id}"][role=tab]`).click();assert.equal(desk.editor.value,'SELECT Id, Name FROM Account');assert.equal(desk.state.rows.length,2);assert.equal(desk.state.selected.size,1);
 document.querySelector(`[aria-controls="${second.root.id}"][role=tab]`).click();root.querySelector('[aria-label="Close Contact 2"]').click();assert.equal(desk.sessions.length,1);button('Reopen closed').click();assert.equal(desk.sessions.length,2);assert.equal(desk.editor.value,'SELECT Id FROM Contact');
 assert.equal(new Set([...document.querySelectorAll('[id]')].map(node=>node.id)).size,document.querySelectorAll('[id]').length);
});
test('named saved queries and history reopen into new tabs without running',async()=>{
 button('Save query').click();type(root.querySelector('[aria-label="Query name"]'),'Reusable Contacts');root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.match(root.querySelector('.query-desk-status').textContent,/saved/);
 button('Saved').click();await tick();const row=root.querySelector('.query-library-row');assert.match(row.textContent,/Reusable Contacts/);row.querySelector('button').click();await tick();assert.equal(desk.sessions.length,3);assert.equal(desk.editor.value,'SELECT Id FROM Contact');assert.equal(desk.state.rows.length,0);
 button('History').click();await tick();assert.match(root.querySelector('.query-library-items').textContent,/SELECT Id, Name FROM Account/);root.querySelector('.query-library-row button').click();await tick();assert.equal(desk.editor.value,'SELECT Id, Name FROM Account');assert.equal(desk.state.rows.length,0);
});

test('History and Saved toggle closed, switch modes and stay closed after a pending load',async()=>{
 button('History').click();await tick();assert.equal(root.querySelector('.query-library').hidden,false);assert.equal(button('History').getAttribute('aria-pressed'),'true');
 button('History').click();assert.equal(root.querySelector('.query-library').hidden,true);assert.equal(button('History').getAttribute('aria-pressed'),'false');
 button('Saved').click();await tick();assert.equal(root.querySelector('.query-library').hidden,false);
 button('History').click();await tick();assert.equal(button('Saved').getAttribute('aria-pressed'),'false');assert.equal(button('History').getAttribute('aria-pressed'),'true');
 button('History').click();button('Saved').click();button('Saved').click();await tick();assert.equal(root.querySelector('.query-library').hidden,true);
});

 test('filtering an open library stays local without worker requests',async()=>{
 button('History').click();await tick();const before=deskMessages.length;
 type(root.querySelector('[aria-label="Find queries"]'),'Account');type(root.querySelector('[aria-label="Find queries"]'),'missing');
 assert.equal(deskMessages.length,before);assert.match(root.querySelector('.query-library-items').textContent,/No matching/);button('History').click();
 });
