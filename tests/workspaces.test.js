import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {initWorkspaceTabs} from '../app/workspaces.js';
test('workspace shortcuts cycle through three tabs from the editor and preserve contents',()=>{
 const dom=new JSDOM('<nav role="tablist">'+['search','query','third'].map((name,index)=>`<button role="tab" data-workspace="${name}" aria-controls="${name}" aria-selected="${index===0}">${name}</button>`).join('')+'</nav><section id="search"></section><section id="query" hidden><textarea>SELECT Id FROM Account</textarea></section><section id="third" hidden></section>');globalThis.document=dom.window.document;
 let blocked=false;initWorkspaceTabs({tablist:document.querySelector('nav'),canSwitch:()=>!blocked});
 const press=key=>document.querySelector('textarea').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,ctrlKey:true,altKey:/^[1-9]$/.test(key),bubbles:true,cancelable:true}));
 press('ArrowRight');assert.equal(document.body.dataset.workspace,'query');press('ArrowRight');assert.equal(document.body.dataset.workspace,'third');press('ArrowRight');assert.equal(document.body.dataset.workspace,'search');press('ArrowLeft');assert.equal(document.body.dataset.workspace,'third');press('2');assert.equal(document.body.dataset.workspace,'query');assert.equal(document.querySelector('textarea').value,'SELECT Id FROM Account');
 blocked=true;press('1');assert.equal(document.body.dataset.workspace,'query');blocked=false;
 document.querySelector('nav').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));assert.equal(document.body.dataset.workspace,'third');
 assert.equal(document.querySelector('[role=tab][data-workspace=third]').getAttribute('aria-selected'),'true');assert.equal(document.querySelector('#query').hidden,true);
 dom.window.close();
});

