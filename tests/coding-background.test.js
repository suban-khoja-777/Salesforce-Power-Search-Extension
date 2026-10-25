import test from 'node:test';
import assert from 'node:assert/strict';
const stored={},created=[],updates=[];let listener,source={id:9,url:'https://acme.lightning.force.com/lightning/page/home'};
const storage={get:async key=>key===null?stored:{[key]:stored[key]},set:async values=>Object.assign(stored,values),remove:async()=>{}};
globalThis.chrome={runtime:{id:'coding-test',onMessage:{addListener:fn=>listener=fn},getURL:path=>`chrome-extension://coding-test/${path}`},cookies:{getAllCookieStores:async()=>[{id:'default',tabIds:[9]}],get:async()=>({value:'SECRET_SESSION'})},tabs:{get:async()=>source,create:async data=>{created.push(data);return {id:25};},update:async(id,data)=>updates.push({id,...data})},storage:{local:storage,session:storage},commands:{onCommand:{addListener(){}}}};
globalThis.fetch=async(url,options)=>{assert.equal(new URL(url).origin,'https://acme.my.salesforce.com');assert.equal(options.headers.Authorization,'Bearer SECRET_SESSION');assert.equal(options.redirect,'error');return {ok:true,json:async()=>({done:true,records:[{Name:'Example',DeveloperName:'hello',NamespacePrefix:null}]})};};
await import('../background.js');const palette={id:'coding-test',url:'chrome-extension://coding-test/app/palette.html',tab:{id:9}},editor={id:'coding-test',url:'chrome-extension://coding-test/app/coding.html',tab:{id:25}};
const send=(message,sender)=>new Promise(resolve=>{if(!listener(message,sender,resolve))resolve(undefined);});
test('Coding binds the created editor to the validated Salesforce tab without exposing tokens',async()=>{
    assert.equal((await send({type:'CODE_CATALOG',sourceTabId:9},editor)).ok,false);
    assert.equal((await send({type:'OPEN_CODING',orgOrigin:'https://evil.test'},palette)).ok,true);
    assert.equal(created[0].openerTabId,9);assert.equal(updates[0].url,'chrome-extension://coding-test/app/coding.html');
    const result=await send({type:'CODE_CATALOG',orgOrigin:'https://evil.test'},editor);assert.equal(result.ok,true);assert.equal(result.members.length,3);assert.doesNotMatch(JSON.stringify([result,stored]),/SECRET_SESSION/);
    assert.equal((await send({type:'CODE_CATALOG'},{...editor,tab:{id:26}})).ok,false);
    assert.equal(await send({type:'CODE_CATALOG'},{...editor,url:'https://evil.test/app/coding.html'}),undefined);
    source={...source,url:'https://another.lightning.force.com/lightning/page/home'};assert.equal((await send({type:'CODE_CATALOG'},editor)).ok,false);
});
