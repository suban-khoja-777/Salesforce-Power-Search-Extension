import {salesforceContext,API_VERSION} from './salesforce.js';
import {isManaged} from './visibility.js';
const base=`/services/data/${API_VERSION}`;
const idPattern=/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
export const DEBUG_CATEGORIES=['ApexCode','ApexProfiling','Callout','Database','System','Validation','Visualforce','Workflow'];
export const DEBUG_LEVELS=['NONE','ERROR','WARN','INFO','DEBUG','FINE','FINER','FINEST'];
export const DEFAULT_DEBUG={minutes:30,levels:Object.fromEntries(DEBUG_CATEGORIES.map(key=>[key,key==='ApexCode'?'DEBUG':'INFO']))};
export function debugSettings(value=DEFAULT_DEBUG){
    if(![15,30,60,120].includes(value.minutes))throw new Error('Choose a debug duration between 15 minutes and 2 hours.');
    const levels={};for(const key of DEBUG_CATEGORIES){if(!DEBUG_LEVELS.includes(value.levels?.[key]))throw new Error(`Invalid debug level for ${key}.`);levels[key]=value.levels[key];}
    return {minutes:value.minutes,levels};
}
export function recordContext(url){
    salesforceContext(url);
    const match=new URL(url).pathname.match(/^\/lightning\/r\/([A-Za-z][A-Za-z0-9_]*)\/([A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?)\/(?:view|edit)\/?$/);
    if(!match||isManaged({type:'object',apiName:match[1]}))return null;
    return {objectName:match[1],id:match[2]};
}
const editableTypes=new Set(['string','textarea','email','phone','url','reference','picklist','multipicklist','boolean','int','double','currency','percent','date','datetime','time']);
export function fieldValue(field,value){
    if(value===null){if(!field.nillable)throw new Error(`${field.name} cannot be cleared.`);return null;}
    if(field.type==='boolean'){if(typeof value!=='boolean')throw new Error(`${field.name} requires true or false.`);return value;}
    if(['int','double','currency','percent'].includes(field.type)){
        if(typeof value!=='number'||!Number.isFinite(value)||(field.type==='int'&&!Number.isInteger(value)))throw new Error(`${field.name} requires a valid number.`);return value;
    }
    if(typeof value!=='string'||value.length>(field.length||1000000))throw new Error(`Invalid value for ${field.name}.`);
    if(field.type==='reference'&&!idPattern.test(value))throw new Error(`${field.name} requires a Salesforce record ID.`);
    if(field.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))))throw new Error(`${field.name} requires YYYY-MM-DD.`);
    if(field.type==='datetime'&&(!/^\d{4}-\d{2}-\d{2}T/.test(value)||Number.isNaN(Date.parse(value))))throw new Error(`${field.name} requires an ISO date and time.`);
    return value;
}
export function createAdminService(request,storage,now=Date.now){
    const snapshots=new Map(),debugBusy=new Set();
    const scope=conn=>`debug-settings:${conn.libraryKey}`;
    async function settings(conn,value){if(value!==undefined)await storage.set({[scope(conn)]:debugSettings(value)});const data=(await storage.get(scope(conn)))[scope(conn)];return debugSettings(data||DEFAULT_DEBUG);}
    async function read(conn,tab){
        const context=recordContext(tab.url);if(!context)throw new Error('Open a Salesforce record page first.');
        const path=`${base}/sobjects/${context.objectName}`;
        const [schema,record]=await Promise.all([request(conn,`${path}/describe/`),request(conn,`${path}/${context.id}`)]);
        if(!Array.isArray(schema.fields)||!record.Id||record.Id.slice(0,15)!==context.id.slice(0,15))throw new Error('Salesforce did not return record details.');
        const fields=schema.fields.filter(f=>!f.deprecatedAndHidden&&Object.hasOwn(record,f.name)&&!/^\w+__\w+__(?:c|r)$/.test(f.name)).map(f=>({name:f.name,label:f.label||f.name,type:f.type,nillable:!!f.nillable,length:f.length,updateable:schema.updateable===true&&f.updateable===true&&editableTypes.has(f.type),picklistValues:(f.picklistValues||[]).filter(v=>v.active).map(v=>({value:v.value,label:v.label})),value:record[f.name]}));
        for(const [key,item] of snapshots)if(item.expires<now()||item.owner===`${conn.cacheKey}:${tab.id}`)snapshots.delete(key);
        if(snapshots.size>=30)snapshots.delete(snapshots.keys().next().value);
        const snapshot=crypto.randomUUID(),modified=record.LastModifiedDate;
        snapshots.set(snapshot,{...context,owner:`${conn.cacheKey}:${tab.id}`,fields,modified,expires:now()+15*60000});
        return {...context,snapshot,fields,orgLabel:conn.orgLabel};
    }
    async function save(conn,tab,snapshot,changes){
        const current=recordContext(tab.url),item=snapshots.get(snapshot);
        if(!item||item.owner!==`${conn.cacheKey}:${tab.id}`||item.expires<now()||current?.id!==item.id||current?.objectName!==item.objectName)throw new Error('Record or session changed. Reload the Record tab before saving.');
        if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length)throw new Error('Change at least one field before saving.');
        const body={};for(const [name,value] of Object.entries(changes)){const field=item.fields.find(f=>f.name===name);if(!field?.updateable)throw new Error(`${name} is read-only or unavailable.`);body[name]=fieldValue(field,value);}
        if(!item.modified||Number.isNaN(Date.parse(item.modified)))throw new Error('This record has no modification timestamp. Editing is unavailable.');
        snapshots.delete(snapshot); // A failed/uncertain write must be reloaded, never retried automatically.
        await request(conn,`${base}/sobjects/${item.objectName}/${item.id}`,'PATCH',body,{'If-Unmodified-Since':new Date(item.modified).toUTCString()});
        return {saved:true};
    }
    async function enableDebug(conn){
        if(debugBusy.has(conn.cacheKey))throw new Error('Debug logging is already being enabled.');debugBusy.add(conn.cacheKey);
        try{
            const config=await settings(conn),identity=await request(conn,'/services/Soap/u/65.0','POST');
            const user=identity.user_id;if(!/^005[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(user||''))throw new Error('Could not identify your current Salesforce user.');
            // Each level configuration has its own name; do not change levels used by other trace flags.
            const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(config.levels))))).slice(0,4).map(b=>b.toString(16).padStart(2,'0')).join('');
            const developerName=`PowerSearch_${user}_${hash}`;
            const query=async q=>(await request(conn,`${base}/tooling/query?q=${encodeURIComponent(q)}`)).records||[];
            const levels=await query(`SELECT Id FROM DebugLevel WHERE DeveloperName = '${developerName}' LIMIT 1`);
            const levelId=levels[0]?.Id||(await request(conn,`${base}/tooling/sobjects/DebugLevel`,'POST',{DeveloperName:developerName,MasterLabel:developerName,...config.levels})).id;
            if(!idPattern.test(levelId||''))throw new Error('Unable to create a debug level.');
            const start=new Date(now()).toISOString(),expiration=new Date(now()+config.minutes*60000).toISOString();
            const flags=await query(`SELECT Id FROM TraceFlag WHERE TracedEntityId = '${user}' AND LogType = 'USER_DEBUG' AND ExpirationDate > ${start} ORDER BY ExpirationDate DESC LIMIT 1`);
            const body={DebugLevelId:levelId,StartDate:start,ExpirationDate:expiration};
            if(flags[0]){if(!idPattern.test(flags[0].Id))throw new Error('Invalid trace flag.');await request(conn,`${base}/tooling/sobjects/TraceFlag/${flags[0].Id}`,'PATCH',body);}
            else await request(conn,`${base}/tooling/sobjects/TraceFlag`,'POST',{...body,TracedEntityId:user,LogType:'USER_DEBUG'});
            return {expiration,userId:user};
        }finally{debugBusy.delete(conn.cacheKey);}
    }
    return {settings,read,save,enableDebug};
}
