import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEntry, parseQuery, searchEntries, destinationFor } from '../lib/search.js';

const entries = [
    { id: '01p000000000001AAA', type: 'apex', label: 'AccountService', apiName: 'AccountService' },
    { id: '01p000000000002AAA', type: 'apex', label: 'MyAccountService', apiName: 'pkg__MyAccountService', namespace: 'pkg' },
    { id: '01q000000000001AAA', type: 'trigger', label: 'AccountTriggerHandler', apiName: 'AccountTriggerHandler' },
    { id: 'Account', type: 'object', label: 'Accounts', apiName: 'Account' },
    { id: 'Invoice__c', type: 'object', label: 'Invoices', apiName: 'Invoice__c' }
].map(prepareEntry);

test('exact API names rank ahead of prefixes and substrings', () => {
    const matches = searchEntries(entries, 'account');
    assert.equal(matches[0].type, 'object');
    assert.ok(matches.some(e => e.label === 'AccountService'));
    assert.ok(!matches.some(e => e.namespace));
});
test('typed filters override chips and are case insensitive', () => {
    assert.deepEqual(parseQuery(' CLASS: account ', 'object'), { category: 'apex', query: 'account' });
    assert.equal(searchEntries(entries, 'trigger: account', { category: 'apex' })[0].type, 'trigger');
});
test('abbreviations match ordered initials', () => {
    assert.equal(searchEntries(entries, 'ath')[0].label, 'AccountTriggerHandler');
});
test('managed filter, categories, and empty query recents are respected', () => {
    assert.equal(searchEntries(entries, '', { hideManaged: true }).length, 4);
    assert.equal(searchEntries(entries, '', { category: 'trigger' }).length, 1);
    assert.equal(searchEntries(entries, '', { recentKeys: ['object:Invoice__c'] })[0].id, 'Invoice__c');
});
test('unmatched queries and punctuation do not throw', () => {
    assert.deepEqual(searchEntries(entries, 'zzzz'), []);
    assert.equal(searchEntries(entries, 'invoice__c')[0].id, 'Invoice__c');
    assert.equal(searchEntries([], '' ).length, 0);
});
test('result limits and deterministic ordering', () => {
    assert.equal(searchEntries(entries, '', { limit: 2 }).length, 2);
    assert.deepEqual(searchEntries([...entries].reverse(), ''), searchEntries(entries, ''));
});
test('destinations distinguish object, class, and trigger setup', () => {
    assert.equal(destinationFor(entries[0]), '/lightning/setup/ApexClasses/page?address=%2F01p000000000001AAA');
    assert.match(destinationFor(entries[2]), /ApexTriggers/);
    assert.equal(destinationFor(entries[4]), '/lightning/setup/ObjectManager/Invoice__c/Details/view');
});
test('unsupported and malformed destinations are rejected', () => {
    assert.throws(() => destinationFor({ type: 'object', apiName: '../escape' }));
    assert.throws(() => destinationFor({ type: 'apex', id: 'https://example.com' }));
    assert.throws(() => destinationFor({ type: 'unsupported', id: '01p000000000001AAA' }));
});
test('large index remains bounded to 30 displayed matches', () => {
    const large = Array.from({ length: 20000 }, (_, i) => prepareEntry({ id: String(i), type: 'apex', label: `AccountService${i}`, apiName: `AccountService${i}` }));
    const start = performance.now();
    assert.equal(searchEntries(large, 'account').length, 30);
    console.log(`20,000-entry search: ${(performance.now() - start).toFixed(1)} ms`);
});


test('All merges and prioritizes component history without duplicates, preserving current names', () => {
    const base = prepareEntry({type:'apex',id:'01p000000000003AAA',apiName:'ZebraService',label:'Current label'});
    const history = prepareEntry({...base,type:'recentcomponent',targetType:'apex',label:'Old label',recentRank:0});
    const other = prepareEntry({type:'apex',id:'01p000000000004AAA',apiName:'AppleService',label:'AppleService'});
    const matches = searchEntries([other,base,history],'',{category:'all'});
    assert.equal(matches.length,2); assert.equal(matches[0].label,'Current label'); assert.equal(matches[0].type,'apex');
    assert.equal(searchEntries([other,base,history],'Zebra',{category:'all'}).length,1);
    assert.match(destinationFor({type:'user',id:'005000000000001AAA'}),/ManageUsers\/page\?address=%2F005/);
    assert.throws(()=>destinationFor({type:'user',id:'01p000000000001AAA'}));
});

test('metadata links target individual items and never silently fall back to category lists',()=>{
 const cases={lwc:['0Rb','LightningComponentBundles'],aura:['0Ab','LightningComponentBundles'],vfpage:['066','ApexPages'],vfcomponent:['099','ApexComponent'],profile:['00e','EnhancedProfiles'],permissionset:['0PS','PermSets'],permissiongroup:['0PG','PermSetGroups'],role:['00E','Roles'],queue:['00G','Queues'],group:['00G','PublicGroups']};
 for(const [type,[prefix,section]] of Object.entries(cases)){
  const id=prefix+'000000000001AAA',path=destinationFor({type,id});const url=new URL(path,'https://acme.lightning.force.com');
  assert.equal(url.pathname,`/lightning/setup/${section}/page`);assert.ok(url.searchParams.get('address').includes(id));
  assert.throws(()=>destinationFor({type,id:'missing'}));assert.throws(()=>destinationFor({type,id:'005000000000001AAA'}));
 }
 assert.equal(new URL(destinationFor({type:'queue',id:'00G000000000001AAA'}),'https://a.test').searchParams.get('address'),'/p/own/Queue/d?id=00G000000000001AAA');
 assert.equal(new URL(destinationFor({type:'group',id:'00G000000000001AAA'}),'https://a.test').searchParams.get('address'),'/setup/own/groupdetail.jsp?id=00G000000000001AAA');
 for(const type of ['app','valueset'])assert.throws(()=>destinationFor({type,id:'missing'}));
});
