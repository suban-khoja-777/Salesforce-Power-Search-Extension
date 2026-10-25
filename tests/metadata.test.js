import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMON_TYPES, mergeCatalog, descriptorFor } from '../lib/catalog.js';
import { soapEnvelope, parseSoap, discoverCatalog, listMetadataCategory, metadataEntry } from '../lib/metadata.js';
import { prepareEntry, searchEntries, destinationFor, hasDestination, parseQuery } from '../lib/search.js';
const xml = (body) => `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;

test('catalog is restricted to the exact allowlist even when Salesforce advertises other types', async () => {
    assert.deepEqual(COMMON_TYPES.map(type => type.key), ['apex','trigger','lwc','aura','vfpage','vfcomponent','flow','profile','permissionset','permissiongroup','app','queue','role','group','valueset','object','recentrecord','user']);
    const catalog = await discoverCatalog(async () => ({ metadataObjects: [{ xmlName: 'CustomField' }, { xmlName: 'NewPlatformType' }] }));
    assert.deepEqual(catalog, COMMON_TYPES);
    assert.equal(descriptorFor('field'), undefined);
});

test('SOAP supports only read-only operations, escapes tokens/folders and bounds batch size', () => {
    const envelope = soapEnvelope('listMetadata', 'FAKE<&TOKEN', [{ type: 'Report', folder: 'Sales & Service' }]);
    assert.match(envelope, /FAKE&lt;&amp;TOKEN/);
    assert.match(envelope, /Sales &amp; Service/);
    assert.throws(() => soapEnvelope('deleteMetadata', 'fake'), /Unsupported/);
    assert.throws(() => soapEnvelope('listMetadata', 'fake', Array(4).fill({ type: 'Report' })), /three/);
});
test('SOAP parser handles namespaces, entities, empty results, faults and rejects entity declarations', () => {
    const value = parseSoap(xml('<m:listMetadataResponse xmlns:m="http://soap.sforce.com/2006/04/metadata"><m:result><m:fullName>Sales/A &amp; B</m:fullName></m:result></m:listMetadataResponse>'), 'listMetadata');
    assert.equal(value.fullName, 'Sales/A & B');
    assert.equal(parseSoap(xml('<listMetadataResponse/>'), 'listMetadata'), undefined);
    assert.equal(parseSoap(xml('<listMetadataResponse><result/></listMetadataResponse>'), 'listMetadata'), undefined);
    assert.throws(() => parseSoap(xml('<Fault><faultcode>INVALID_SESSION_ID</faultcode><faultstring>SECRET_TOKEN</faultstring></Fault>'), 'listMetadata'), (error) => /INVALID_SESSION_ID/.test(error.message) && !/SECRET_TOKEN/.test(error.message));
    assert.throws(() => parseSoap('<!DOCTYPE x><x/>', 'listMetadata'), /invalid/);
    assert.throws(() => parseSoap('<broken>', 'listMetadata'), /invalid/);
});
test('name-only metadata strips source and secret properties', async () => {
    const result = await listMetadataCategory(descriptorFor('lwc'), async () => [{ id:'0Rb000000000001AAA', fullName:'accountSearch', namespacePrefix:null, secret:'SECRET' }, {fullName:'pkg__Widget',namespacePrefix:'pkg'}, {fullName:'InstalledWidget',manageableState:'installed'}]);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].namespace, null);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});
test('listing caps warn rather than claiming complete coverage', async () => {
    const result = await listMetadataCategory(descriptorFor('flow'), async () => Array.from({length:1000}, (_,i) => ({fullName:`Flow${i}`})));
    assert.match(result.warnings[0], /1,000/);
});
test('selected types accept prefixes and excluded types have no destinations', () => {
    assert.equal(parseQuery('LightningComponentBundle: account').category,'lwc');
    assert.equal(parseQuery('field: tier').category,'all');
    assert.throws(() => destinationFor({type:'field',apiName:'Account.Tier__c'}));
    assert.throws(() => destinationFor({type:'meta_NewPlatformType'}));
    assert.equal(destinationFor({type:'flow',id:'301000000000001AAA'}),'/builder_platform_interaction/flowBuilder.app?flowId=301000000000001AAA');
});
test('recent components retain their actual type and route; recent records validate object and ID', () => {
    const entry = prepareEntry({type:'recentcomponent',targetType:'apex',id:'01p000000000001AAA',label:'Zip',apiName:'Zip'});
    assert.equal(entry.typeLabel,'Apex class');
    assert.equal(destinationFor(entry),destinationFor({...entry,type:'apex'}));
    assert.equal(searchEntries([entry],'',{category:'all'}).length,1);
    assert.equal(searchEntries([entry],'',{category:'apex'}).length,1);
    assert.equal(destinationFor({type:'recentrecord',recordType:'Case',id:'500000000000001AAA'}),'/lightning/r/Case/500000000000001AAA/view');
    assert.throws(() => destinationFor({type:'recentrecord',recordType:'//evil.test',id:'500000000000001AAA'}));
    assert.throws(() => destinationFor({type:'recentcomponent',targetType:'recentcomponent'}));
});

test('metadata audit attributes preserve dates and author names without source data',()=>{
 const item=metadataEntry({fullName:'Test',id:'0Rb000000000001AAA',createdDate:'2026-10-01T00:00:00Z',createdByName:'Alex',lastModifiedDate:'2026-10-15T00:00:00Z',lastModifiedByName:'Taylor',body:'PRIVATE_SOURCE'},descriptorFor('lwc'));
 assert.equal(item.createdBy,'Alex');assert.equal(item.lastModifiedBy,'Taylor');assert.equal(item.createdDate,'2026-10-01T00:00:00Z');assert.doesNotMatch(JSON.stringify(item),/PRIVATE_SOURCE/);
});
