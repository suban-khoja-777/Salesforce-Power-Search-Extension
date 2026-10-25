import {CODE_TYPES,componentKey,validComponent,validateFiles,unpackProject,projectZip,toBase64,fileHashes,hashesEqual} from './coding-files.js';
import {escapeXml} from './metadata.js';
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const done=value=>value===true||value==='true';
const xmlId=id=>{if(!/^[A-Za-z0-9]{15,18}$/.test(id))throw new Error('Invalid Salesforce job ID.');return id;};
export function codingEnvelope(operation,token,body){
    if(!['retrieve','checkRetrieveStatus','deploy','checkDeployStatus'].includes(operation))throw new Error('Unsupported code operation.');
    return `<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns="http://soap.sforce.com/2006/04/metadata"><env:Header><SessionHeader><sessionId>${escapeXml(token)}</sessionId></SessionHeader></env:Header><env:Body><${operation}>${body}</${operation}></env:Body></env:Envelope>`;
}
export function retrieveBody(members){return `<retrieveRequest><apiVersion>65.0</apiVersion><singlePackage>true</singlePackage><unpackaged>${Object.entries(CODE_TYPES).map(([type,kind])=>{const list=members.filter(m=>m.type===type);return list.length?`<types>${list.map(m=>`<members>${escapeXml(m.name)}</members>`).join('')}<name>${kind.xml}</name></types>`:'';}).join('')}<version>65.0</version></unpackaged></retrieveRequest>`;}

// Persist job IDs and source snapshots across MV3 worker suspensions; never persist tokens.
export function createCodingService({rest,soap,storage,now=Date.now}){
    const locks=new Map();
    const owner=(conn,tabId)=>`${conn.cacheKey}:${tabId}`;
    const key=id=>`coding:${id}`;
    async function put(value,id=crypto.randomUUID()){await storage.set({[key(id)]:{...value,expires:now()+8*60*60*1000}});return id;}
    async function get(id,conn,tabId){if(typeof id!=='string'||!/^[-a-f0-9]{36}$/.test(id))throw new Error('Invalid code workspace handle.');const value=(await storage.get(key(id)))[key(id)];if(!value||value.owner!==owner(conn,tabId)||value.expires<now())throw new Error('Code workspace expired or belongs to another session. Reopen the component.');return value;}
    async function catalog(conn){
        const lists=await Promise.all(Object.entries(CODE_TYPES).map(async([type,kind])=>{
            let path=`/services/data/v65.0/tooling/query?q=${encodeURIComponent(`SELECT Id, ${kind.nameField}, NamespacePrefix FROM ${kind.object} WHERE NamespacePrefix = null ORDER BY ${kind.nameField}`)}`;const items=[],seen=new Set();
            while(path){if(seen.has(path)||seen.size>=100)throw new Error('Component listing exceeded its page limit.');seen.add(path);const page=await rest(conn,path);for(const row of page.records||[]){const item={type,name:row[kind.nameField]};if(!row.NamespacePrefix&&validComponent(item))items.push(item);}path=page.done?null:page.nextRecordsUrl;if(!page.done&&!path)throw new Error('Incomplete component listing.');}return items;
        }));return {members:lists.flat(),orgLabel:conn.orgLabel,orgKey:conn.libraryKey};
    }
    async function retrieve(conn,members){const result=await soap(conn,'retrieve',retrieveBody(members));return xmlId(result?.id);}
    async function start(conn,tabId,selection){
        const {members:all}=await catalog(conn);
        const members=selection==='all'?all:all.filter(item=>componentKey(item)===componentKey(selection||{}));
        if(!members.length)throw new Error('No editable local components found.');
        const remoteId=await retrieve(conn,members);return {job:await put({owner:owner(conn,tabId),stage:'retrieve',remoteId,members})};
    }
    async function saveOnce(conn,tabId,snapshot,files){
        const original=await get(snapshot,conn,tabId);
        if(original.stage!=='snapshot')throw new Error('Reload the component before saving.');
        validateFiles(files,original.members,Object.keys(original.hashes));
        if(hashesEqual(await fileHashes(files),original.hashes))throw new Error('There are no changes to save.');
        // One pending save per snapshot, including across worker restarts.
        if(original.pending)throw new Error('A save is already pending for this snapshot. Reload after it completes.');
        await put({...original,pending:true},snapshot);
        try{const remoteId=await retrieve(conn,original.members);return {job:await put({owner:owner(conn,tabId),stage:'preflight',remoteId,members:original.members,hashes:original.hashes,files})};}
        catch(error){await put({...original,pending:false},snapshot);throw error;}
    }
    async function save(conn,tabId,snapshot,files){const lock=`save:${owner(conn,tabId)}:${snapshot}`;if(locks.has(lock))throw new Error('A save is already pending for this snapshot.');const task=saveOnce(conn,tabId,snapshot,files);locks.set(lock,task);try{return await task;}finally{locks.delete(lock);}}
    async function pollOnce(conn,tabId,id){
        const job=await get(id,conn,tabId);
        if(job.stage==='finished')return job.result;
        if(job.stage==='starting-deploy')throw new Error('Deployment outcome is unknown. Check Salesforce Deployment Status before saving again.');
        if(!['retrieve','preflight','deploy'].includes(job.stage))throw new Error('Invalid coding job.');
        if(job.stage==='deploy'){
            const result=await soap(conn,'checkDeployStatus',`<asyncProcessId>${xmlId(job.remoteId)}</asyncProcessId><includeDetails>true</includeDetails>`);
            if(!done(result.done))return {done:false,status:result.status||'Deploying',deploymentId:job.remoteId};
            const errors=[...array(result.details?.componentFailures).map(f=>({path:String(f.fileName||''),line:Number(f.lineNumber)||1,column:Number(f.columnNumber)||1,message:String(f.problem||'Compilation failed').slice(0,2000)})),...array(result.details?.runTestResult?.failures).map(f=>({path:'',line:1,column:1,message:`${f.name||'Test'}: ${f.message||'failed'}`.slice(0,2000)}))];
            if(!done(result.success)&&!errors.length)errors.push({path:'',line:1,column:1,message:String(result.errorMessage||result.status||'Deployment failed').slice(0,2000)});
            const snapshot=await put({owner:job.owner,stage:'snapshot',members:job.members,hashes:done(result.success)?job.newHashes:job.baseHashes});
            const response={done:true,saved:done(result.success),errors,snapshot,deploymentId:job.remoteId};await put({owner:job.owner,stage:'finished',result:response},id);return response;
        }
        const result=await soap(conn,'checkRetrieveStatus',`<asyncProcessId>${xmlId(job.remoteId)}</asyncProcessId><includeZip>true</includeZip>`);
        if(!done(result.done))return {done:false,status:job.stage==='preflight'?'Checking Salesforce changes':'Retrieving source'};
        if(result.status!=='Succeeded'||!result.zipFile||array(result.messages).length)return {done:true,failed:true,error:'Source retrieval was incomplete. Check metadata permissions and retry.'};
        const files=unpackProject(result.zipFile,job.members),hashes=await fileHashes(files);
        if(job.stage==='retrieve'){
            const snapshot=await put({owner:job.owner,stage:'snapshot',members:job.members,hashes});
            return {done:true,files,members:job.members,snapshot};
        }
        if(!hashesEqual(job.hashes,hashes))return {done:true,failed:true,error:'Source changed in Salesforce since you opened it. Download your edits, then reload and merge before saving.'};
        const zip=toBase64(projectZip(job.files,job.members)),newHashes=await fileHashes(job.files);
        // Record the ambiguous state before a non-idempotent deployment request; never auto-submit twice.
        await put({owner:job.owner,stage:'starting-deploy'},id);
        let deployed;
        try{deployed=await soap(conn,'deploy',`<ZipFile>${zip}</ZipFile><DeployOptions><allowMissingFiles>false</allowMissingFiles><autoUpdatePackage>false</autoUpdatePackage><checkOnly>false</checkOnly><ignoreWarnings>false</ignoreWarnings><performRetrieve>false</performRetrieve><purgeOnDelete>false</purgeOnDelete><rollbackOnError>true</rollbackOnError><singlePackage>true</singlePackage><testLevel>RunLocalTests</testLevel></DeployOptions>`);}
        catch{throw new Error('Deployment outcome is unknown. Check Salesforce Deployment Status before saving again.');}
        const remoteId=xmlId(deployed?.id);
        await put({owner:job.owner,stage:'deploy',remoteId,members:job.members,newHashes,baseHashes:job.hashes},id);
        return {done:false,status:'Deploying and running local Apex tests',deploymentId:remoteId};
    }
    async function poll(conn,tabId,id){const lock=`${owner(conn,tabId)}:${id}`;if(locks.has(lock))return locks.get(lock);const task=pollOnce(conn,tabId,id);locks.set(lock,task);try{return await task;}finally{locks.delete(lock);}}
    async function cleanup(){const all=await storage.get(null);const expired=Object.entries(all).filter(([k,v])=>k.startsWith('coding:')&&v.expires<now()).map(([k])=>k);if(expired.length)await storage.remove(expired);}
    return {catalog,start,save,poll,cleanup};
}
