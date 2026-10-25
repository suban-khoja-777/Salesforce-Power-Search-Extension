import test from 'node:test';
import assert from 'node:assert/strict';
import {createQueryLibrary} from '../lib/query-library.js';
const stored={};const storage={get:async key=>({[key]:structuredClone(stored[key])}),set:async value=>Object.assign(stored,structuredClone(value))};
test('query library persists history and saves, isolates orgs, serializes parallel writes',async()=>{
 const library=createQueryLibrary(storage);await Promise.all([library.record('org-a','Account','SELECT Id FROM Account'),library.record('org-a','Contact','SELECT Id FROM Contact')]);assert.equal((await library.read('org-a')).history.length,2);assert.equal((await library.read('org-b')).history.length,0);
 await library.record('org-a','Account','SELECT Id FROM Account');assert.equal((await library.read('org-a')).history.length,2);
 let data=await library.save('org-a',{objectName:'Account',query:'SELECT Id, Name FROM Account',name:'Accounts'});const id=data.saved[0].id;
 data=await library.save('org-a',{id,objectName:'Account',query:'SELECT Id FROM Account',name:'Updated'});assert.equal(data.saved.length,1);assert.equal(data.saved[0].name,'Updated');
 const reopened=createQueryLibrary(storage);assert.equal((await reopened.read('org-a')).saved[0].id,id);await reopened.clearHistory('org-a');assert.equal((await reopened.read('org-a')).history.length,0);assert.equal((await reopened.read('org-a')).saved.length,1);
 await reopened.remove('org-a',id);assert.equal((await reopened.read('org-a')).saved.length,0);assert.throws(()=>library.save('org-a',{objectName:'pkg__Secret__c',query:'SELECT Id FROM pkg__Secret__c'}));
});
test('history has a 50-entry limit and corrupt stored entries are excluded',async()=>{
 const library=createQueryLibrary(storage);for(let index=0;index<55;index++)await library.record('org-c','Account',`SELECT Id FROM Account LIMIT ${index+1}`);assert.equal((await library.read('org-c')).history.length,50);
 stored['query-library:v1:org-c'].saved=[{id:'bad',name:'Bad',objectName:'Account',query:'DELETE FROM Account'}];assert.deepEqual((await library.read('org-c')).saved,[]);
});
