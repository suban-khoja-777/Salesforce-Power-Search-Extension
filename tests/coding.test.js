import test from 'node:test';
import assert from 'node:assert/strict';
import {createCodingService,codingEnvelope} from '../lib/coding-service.js';
import {projectZip,toBase64,unpackProject,validateFiles,fileOwner} from '../lib/coding-files.js';
import {createLocalProject} from '../app/coding-local.js';
const member={type:'apex',name:'Example'},files={'classes/Example.cls':'public class Example {}','classes/Example.cls-meta.xml':'<ApexClass><apiVersion>65.0</apiVersion><status>Active</status></ApexClass>'};
const conn={cacheKey:'sessionA',libraryKey:'orgA:storeA',orgLabel:'Org A'};
function harness(){const stored={},calls=[];let source={...files},success=true,deploymentError=false;
    const storage={get:async key=>key===null?{...stored}:{[key]:stored[key]},set:async data=>Object.assign(stored,structuredClone(data)),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete stored[key];}};
    const rest=async(_conn,path)=>{calls.push({path});return {done:true,records:path.includes('ApexClass')?[{Name:'Example',NamespacePrefix:null},{Name:'pkg__Managed',NamespacePrefix:'pkg'}]:[]};};
    const soap=async(_conn,operation,body)=>{calls.push({operation,body});if(operation==='retrieve')return {id:'09S000000000001AAA'};if(operation==='checkRetrieveStatus')return {done:'true',status:'Succeeded',zipFile:toBase64(projectZip(source,[member]))};if(operation==='deploy'){if(deploymentError)throw new Error('timeout');return {id:'0Af000000000001AAA'};}if(operation==='checkDeployStatus')return {done:'true',success:String(success),status:success?'Succeeded':'Failed',details:success?{}:{componentFailures:{fileName:'classes/Example.cls',lineNumber:1,columnNumber:2,problem:'Unexpected token'}}};};
    const make=()=>createCodingService({rest,soap,storage});return {make,calls,stored,setSource:value=>source=value,setSuccess:value=>success=value,setDeployError:value=>deploymentError=value};
}
test('code ZIP round trips companion files; paths and missing bundles cannot reach deployment',()=>{
    assert.deepEqual({...unpackProject(toBase64(projectZip(files,[member])),[member])},files);
    assert.throws(()=>validateFiles({'classes/Example.cls':'x'},[member]),/Incomplete/);
    for(const path of ['../Example.cls','classes/../Example.cls','classes\\Example.cls','classes/pkg__Managed.cls','destructiveChanges.xml','lwc/Example/test.exe'])assert.equal(fileOwner(path,[member]),null);
    assert.throws(()=>validateFiles({...files,'classes/Other.cls':'x'},[member]),/Unsupported/);
    assert.throws(()=>validateFiles(files,[member],['classes/Example.cls']),/added or deleted/);
    const bundle={type:'lwc',name:'hello'},lwc={'lwc/hello/hello.js':'export default class Hello {}','lwc/hello/hello.html':'<template/>','lwc/hello/hello.js-meta.xml':'<LightningComponentBundle/>'};
    assert.equal(Object.keys(unpackProject(toBase64(projectZip(lwc,[bundle])),[bundle])).length,3);
    assert.match(codingEnvelope('deploy','a<&','<ZipFile/>'),/a&lt;&amp;/);assert.throws(()=>codingEnvelope('deleteMetadata','secret',''),/Unsupported/);
});
test('catalog excludes packages; retrieved source snapshots are bound to session and editor tab',async()=>{
    const h=harness(),s=h.make();assert.deepEqual((await s.catalog(conn)).members,[member]);
    await assert.rejects(()=>s.start(conn,3,{type:'apex',name:'pkg__Managed'}),/No editable/);
    const {job}=await s.start(conn,3,member);await assert.rejects(()=>s.poll(conn,4,job),/another session/);await assert.rejects(()=>s.poll({...conn,cacheKey:'other'},3,job),/another session/);
    const loaded=await h.make().poll(conn,3,job);assert.equal(loaded.files['classes/Example.cls'],files['classes/Example.cls']);assert.ok(loaded.snapshot);assert.doesNotMatch(JSON.stringify(h.stored),/token/);
});
test('save checks concurrent Salesforce changes and never deploys a stale bundle',async()=>{
    const h=harness(),s=h.make();const loaded=await s.poll(conn,3,(await s.start(conn,3,member)).job);
    const edits={...files,'classes/Example.cls':'public class Example { Integer n; }'};
    const save=await s.save(conn,3,loaded.snapshot,edits);await assert.rejects(()=>s.save(conn,3,loaded.snapshot,edits),/pending/);
    h.setSource({...files,'classes/Example.cls':'public class Example { String external; }'});
    const result=await s.poll(conn,3,save.job);assert.equal(result.failed,true);assert.match(result.error,/changed in Salesforce/);assert.equal(h.calls.filter(c=>c.operation==='deploy').length,0);
});
test('deployment is atomic, runs tests, survives worker restart, and concurrent polls submit once',async()=>{
    const h=harness(),s=h.make(),loaded=await s.poll(conn,3,(await s.start(conn,3,member)).job),edits={...files,'classes/Example.cls':'public class Example { Integer n; }'};
    const saved=await s.save(conn,3,loaded.snapshot,edits);await Promise.all([s.poll(conn,3,saved.job),s.poll(conn,3,saved.job)]);
    const calls=h.calls.filter(c=>c.operation==='deploy');assert.equal(calls.length,1);assert.match(calls[0].body,/<rollbackOnError>true/);assert.match(calls[0].body,/<testLevel>RunLocalTests/);
    const result=await h.make().poll(conn,3,saved.job);assert.equal(result.saved,true);assert.ok(result.snapshot);assert.deepEqual(await s.poll(conn,3,saved.job),result);
});
test('compilation errors preserve the original baseline for a corrected save',async()=>{
    const h=harness(),s=h.make(),loaded=await s.poll(conn,3,(await s.start(conn,3,member)).job);h.setSuccess(false);
    const save=await s.save(conn,3,loaded.snapshot,{...files,'classes/Example.cls':'bad source'});await s.poll(conn,3,save.job);const failed=await s.poll(conn,3,save.job);assert.equal(failed.saved,false);assert.match(failed.errors[0].message,/Unexpected token/);
    assert.ok((await s.save(conn,3,failed.snapshot,{...files,'classes/Example.cls':'public class Example { Integer fixed; }'})).job);
});
test('an ambiguous deploy is not automatically submitted again',async()=>{
    const h=harness(),s=h.make(),loaded=await s.poll(conn,3,(await s.start(conn,3,member)).job);const save=await s.save(conn,3,loaded.snapshot,{...files,'classes/Example.cls':'changed'});h.setDeployError(true);await assert.rejects(()=>s.poll(conn,3,save.job),/outcome is unknown/);await assert.rejects(()=>h.make().poll(conn,3,save.job),/outcome is unknown/);assert.equal(h.calls.filter(c=>c.operation==='deploy').length,1);
});
function folderMock(initial={}){const disk={...initial};const missing=()=>{const e=new Error('missing');e.name='NotFoundError';throw e;};const directory=prefix=>({name:'Project',queryPermission:async()=> 'granted',getDirectoryHandle:async part=>directory(prefix+part+'/'),getFileHandle:async(name,{create}={})=>{const path=prefix+name;if(!create&&!Object.hasOwn(disk,path))missing();return {getFile:async()=>({text:async()=>disk[path]}),createWritable:async()=>{let text;return {write:async value=>{text=value;},close:async()=>{disk[path]=text;},abort:async()=>{}};}};}});return {disk,handle:directory('')};}
test('local sync requires matching org, preserves external edits, and writes project companions',async()=>{
    const mock=folderMock(),local=createLocalProject();await local.connect(mock.handle,'orgA');await local.save(files);assert.equal(mock.disk['classes/Example.cls-meta.xml'],files['classes/Example.cls-meta.xml']);
    await local.save({...files,'classes/Example.cls':'updated'});mock.disk['classes/Example.cls']='external editor change';await assert.rejects(()=>local.save({...files,'classes/Example.cls':'overwrite'}),/Local file changed/);assert.equal(mock.disk['classes/Example.cls'],'external editor change');
    await assert.rejects(()=>createLocalProject().connect(mock.handle,'orgB'),/another Salesforce org/);
    const fresh=createLocalProject();await fresh.connect(folderMock({'classes/Example.cls':'existing work'}).handle,'orgA');await assert.rejects(()=>fresh.save(files),/different content/);
});
