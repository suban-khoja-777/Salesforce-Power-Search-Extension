import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const source = await readFile(new URL('../content.js',import.meta.url),'utf8');
test('saved layout, live switching, origin validation and viewport sizing work in the content host', async () => {
    const dom = new JSDOM('<html><body><button id="previous">Salesforce</button></body></html>',{url:'https://acme.lightning.force.com/lightning/page/home',runScripts:'outside-only',pretendToBeVisual:true});
    const {window} = dom; let listener;
    const attach = window.HTMLElement.prototype.attachShadow;
    window.HTMLElement.prototype.attachShadow = function() { return attach.call(this,{mode:'open'}); };
    window.chrome = {runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:{addListener:callback=>{listener=callback;}}},storage:{local:{get:async()=>({displayMode:'sidebar'})}}};
    window.__powerSearchContentV040=true; // A legacy guard must not block a new host.
    window.eval(source);
    listener({type:'TOGGLE_POWER_SEARCH_V080'}, {},()=>{}); await new Promise(resolve=>setImmediate(resolve));
    const host=window.document.querySelector('#power-search-extension-root'), frame=host.shadowRoot.querySelector('iframe');
    assert.equal(host.dataset.mode,'sidebar'); assert.equal(frame.style.height,`${window.innerHeight}px`);
    const message = (mode,origin='chrome-extension://test-extension') => window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,origin,data:{type:'POWER_SEARCH_MODE',mode}}));
    message('fullpage','https://evil.example'); assert.equal(host.dataset.mode,'sidebar');
    message('fullpage'); assert.equal(host.dataset.mode,'fullpage');
    message('popup'); assert.equal(host.dataset.mode,'popup'); assert.equal(frame.style.height,`${window.innerHeight*.9}px`);
    message('untrusted-mode'); assert.equal(host.dataset.mode,'popup');
    window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,origin:'chrome-extension://test-extension',data:{type:'POWER_SEARCH_RESIZE',height:9000}}));
    assert.equal(frame.style.height,`${window.innerHeight*.9}px`);
    Object.defineProperty(window,'innerHeight',{value:1000,configurable:true});window.dispatchEvent(new window.Event('resize'));assert.equal(frame.style.height,'900px');
    assert.match(host.shadowRoot.querySelector('style').textContent,/width:90vw/);
    message('sidebar');
    window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,origin:'chrome-extension://test-extension',data:{type:'POWER_SEARCH_RESIZE',height:220}}));
    assert.equal(frame.style.height,`${window.innerHeight}px`);
    listener({type:'TOGGLE_POWER_SEARCH_V080'}, {},()=>{}); assert.equal(host.hasAttribute('data-open'),false);
    dom.window.close();
});

test('viewport and focus wait for the current iframe ready handshake, including reopen',async()=>{
 const dom=new JSDOM('<html><body></body></html>',{url:'https://acme.lightning.force.com',runScripts:'outside-only',pretendToBeVisual:true});const {window}=dom;let listener;const posts=[];
 const attach=window.HTMLElement.prototype.attachShadow;window.HTMLElement.prototype.attachShadow=function(){return attach.call(this,{mode:'open'});};
 const create=window.document.createElement.bind(window.document);window.document.createElement=(tag,...args)=>{const node=create(tag,...args);if(tag==='iframe')Object.defineProperty(node,'contentWindow',{value:{postMessage:(message,origin)=>posts.push({message,origin,frame:node})}});return node;};
 window.chrome={runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:{addListener:fn=>listener=fn}},storage:{local:{get:async()=>({displayMode:'popup'})}}};
 window.eval(source);const toggle=()=>listener({type:'TOGGLE_POWER_SEARCH_V080'},{},()=>{});const getFrame=()=>window.document.querySelector('#power-search-extension-root').shadowRoot.querySelector('iframe');
 const send=(frame,origin='chrome-extension://test-extension',type='POWER_SEARCH_READY')=>window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,origin,data:{type}}));
 toggle();await new Promise(resolve=>setImmediate(resolve));const first=getFrame();window.dispatchEvent(new window.Event('resize'));first.dispatchEvent(new window.Event('load'));assert.equal(posts.length,0,'append, preference loading, resize and load cannot send to an unready frame');
 send(first,'https://acme.lightning.force.com');assert.equal(posts.length,0);
 send(first);assert.deepEqual(posts.map(p=>p.message.type),['POWER_SEARCH_VIEWPORT','POWER_SEARCH_FOCUS']);assert.ok(posts.every(p=>p.origin==='chrome-extension://test-extension'));
 window.dispatchEvent(new window.Event('resize'));assert.equal(posts.at(-1).message.type,'POWER_SEARCH_VIEWPORT');
 const oldWindow=first.contentWindow;toggle();toggle();await new Promise(resolve=>setImmediate(resolve));const second=getFrame(),count=posts.length;
 window.dispatchEvent(new window.MessageEvent('message',{source:oldWindow,origin:'chrome-extension://test-extension',data:{type:'POWER_SEARCH_READY'}}));window.dispatchEvent(new window.Event('resize'));assert.equal(posts.length,count,'old frame cannot unlock the new frame');
 send(second);assert.equal(posts.length,count+2);assert.equal(posts.at(-1).frame,second);dom.window.close();
});
