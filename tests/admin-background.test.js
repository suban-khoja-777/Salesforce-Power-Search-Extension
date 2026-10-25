import test from 'node:test';
import assert from 'node:assert/strict';
const id='001000000000001AAA',calls=[],tabs=[],stored={};let listener,conflict=false;
const tab={id:9,url:`https://acme.lightning.force.com/lightning/r/Account/${id}/view`};
globalThis.chrome={runtime:{id:'admin-test',onMessage:{addListener:fn=>listener=fn}},cookies:{getAllCookieStores:async()=>[{id:'default',tabIds:[9]}],get:async()=>({value:'SECRET_SESSION'})},tabs:{get:async()=>tab,create:async value=>tabs.push(value)},storage:{local:{get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,value)}},commands:{onCommand:{addListener(){}}}};
globalThis.fetch=async(url,options)=>{
 assert.equal(new URL(url).origin,'https://acme.my.salesforce.com');assert.equal(options.headers.Authorization,'Bearer SECRET_SESSION');assert.equal(options.redirect,'error');calls.push({url,options});
 let data={};if(url.includes('/Soap/u/'))return {ok:true,status:200,text:async()=>'<Envelope><Body><getUserInfoResponse><result><userId>005000000000001AAA</userId></result></getUserInfoResponse></Body></Envelope>'};
 if(url.includes('/tooling/query'))data={records:[]};
 else if(options.method==='POST')data={id:url.endsWith('DebugLevel')?'7dl000000000001AAA':'7tf000000000001AAA'};
 else if(options.method==='PATCH')return {ok:!conflict,status:conflict?412:204};
 else if(url.endsWith('describe/'))data={updateable:true,fields:[{name:'Name',type:'string',updateable:true,nillable:false},{name:'LastModifiedDate',type:'datetime',updateable:false}]};
 else data={Id:id,Name:'Acme',LastModifiedDate:'2026-10-15T08:00:00Z'};
 return {ok:true,status:200,json:async()=>data};
};
await import('../background.js');const sender={id:'admin-test',url:'chrome-extension://admin-test/app/palette.html',tab:{id:9}};
const send=(message,from=sender)=>new Promise(resolve=>{if(!listener(message,from,resolve))resolve(undefined);});
test('record worker derives record from host tab, handles empty PATCH success and conflicts',async()=>{
 assert.equal(await send({type:'RECORD_GET'},{...sender,url:'https://evil.test'}),undefined);
 let data=await send({type:'RECORD_GET',id:'001000000000002AAA',origin:'https://evil.test'});assert.equal(data.id,id);assert.doesNotMatch(JSON.stringify(data),/SECRET_SESSION/);
 assert.equal((await send({type:'RECORD_SAVE',snapshot:data.snapshot,changes:{Name:'Updated'}})).saved,true);
 data=await send({type:'RECORD_GET'});conflict=true;const result=await send({type:'RECORD_SAVE',snapshot:data.snapshot,changes:{Name:'Conflict'}});assert.equal(result.ok,false);assert.match(result.error,/changed in Salesforce/);conflict=false;
 tab.url='https://acme.lightning.force.com/lightning/o/Account/list';assert.equal((await send({type:'RECORD_CONTEXT'})).context,null);assert.equal((await send({type:'RECORD_GET'})).ok,false);
});
test('debug activation opens Debug Logs only after current-user trace creation',async()=>{
 const result=await send({type:'DEBUG_ENABLE',userId:'005000000000999AAA'});assert.equal(result.ok,true);assert.equal(tabs.at(-1).url,'https://acme.lightning.force.com/lightning/setup/ApexDebugLogs/home');assert.equal(tabs.at(-1).openerTabId,9);
 const trace=calls.find(call=>call.options.method==='POST'&&call.url.endsWith('TraceFlag'));assert.equal(JSON.parse(trace.options.body).TracedEntityId,'005000000000001AAA');assert.doesNotMatch(JSON.stringify(result),/SECRET_SESSION/);
});
