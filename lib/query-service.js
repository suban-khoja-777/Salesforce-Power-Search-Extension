import {API_VERSION,CACHE_TTL} from './salesforce.js';
import {isManaged} from './visibility.js';
import {objectName,validateQuery,MAX_QUERY_ROWS,RECORD_ID} from './records.js';
export function createQueryService(request, now=Date.now) {
    const schemas=new Map(), catalogs=new Map(), pending=new Map(), runs=new Map(), tickets=new Map();
    async function cached(store,key,load,limit=50) {
        prune();if(store.has(key))return store.get(key).value;
        if(pending.has(key))return pending.get(key);
        const task=Promise.resolve().then(load).then(value=>{if(store.size>=limit)store.delete(store.keys().next().value);store.set(key,{value,expires:now()+CACHE_TTL});return value;}).finally(()=>pending.delete(key));
        pending.set(key,task);return task;
    }
    const prune=()=>{for(const store of [schemas,catalogs,runs,tickets])for(const [key,value] of store)if(value.expires<now())store.delete(key);};
    const owner=(conn,tab)=>`${conn.cacheKey}:${tab}`;
    async function objects(conn) {
        return cached(catalogs,`objects:${conn.cacheKey}`,async()=>{
        const data=await request(conn,`/services/data/${API_VERSION}/sobjects/`);
        if(!Array.isArray(data.sobjects))throw new Error('Unexpected object list response.');
        return data.sobjects.filter(o=>o.queryable && !o.deprecatedAndHidden && !isManaged({type:'object',apiName:o.name})).map(o=>({name:o.name,label:o.label || o.name}));
        },10);
    }
    async function describe(conn,name) {
        prune(); objectName(name); const key=`${conn.cacheKey}:${name}`;
        return cached(schemas,key,async()=>{
        const allowed=await objects(conn);if(!allowed.some(o=>o.name===name))throw new Error('This object is unavailable for queries.');
        const data=await request(conn,`/services/data/${API_VERSION}/sobjects/${name}/describe/`);
        if(!Array.isArray(data.fields) || data.queryable===false)throw new Error('This object cannot be queried.');
        const value={name,label:data.label || name,keyPrefix:data.keyPrefix || null,deletable:data.deletable===true,fields:data.fields.filter(f=>!f.deprecatedAndHidden && !/^[A-Za-z][A-Za-z0-9_]*__[A-Za-z][A-Za-z0-9_]*__(?:c|r)$/.test(f.name)).map(f=>({name:f.name,label:f.label || f.name,type:f.type,...(['picklist','multipicklist'].includes(f.type)?{picklistValues:(f.picklistValues||[]).filter(item=>typeof item.value==='string').map(item=>({value:item.value,label:item.label||item.value,active:item.active!==false}))}:{})}))};
        return value;
        });
    }
    function getRun(conn,tab,id) {prune();const run=runs.get(id);if(!run || run.owner!==owner(conn,tab))throw new Error('This query session expired or the Salesforce session changed. Run the query again.');return run;}
    function page(run,data) {
        if(!Array.isArray(data.records) || typeof data.done!=='boolean')throw new Error('Unexpected query response.');
        if(!data.done && !/^\/services\/data\/v\d+\.\d+\/query\/[A-Za-z0-9_-]+$/.test(data.nextRecordsUrl || ''))throw new Error('Salesforce returned an invalid query cursor.');
        const records=data.records.slice(0,MAX_QUERY_ROWS-run.count);run.count+=records.length;
        for(const record of records)if(RECORD_ID.test(record.Id || '') && record.attributes?.type===run.object && (!run.prefix || record.Id.startsWith(run.prefix)))run.ids.add(record.Id);
        run.next=data.done?null:data.nextRecordsUrl;run.capped=run.count>=MAX_QUERY_ROWS && (!data.done || records.length<data.records.length);
        run.total=Number.isFinite(data.totalSize)?data.totalSize:run.total;run.expires=now()+CACHE_TTL;
        return {queryId:run.id,records,selectableIds:records.filter(record=>run.ids.has(record.Id)).map(record=>record.Id),total:run.total,done:!run.next&&!run.capped,capped:run.capped,canDelete:run.deletable,objectName:run.object,orgOrigin:run.origin,orgLabel:run.orgLabel};
    }
    async function run(conn,tab,name,query) {
        prune();validateQuery(query,name);const schema=await describe(conn,name);
        const data=await request(conn,`/services/data/${API_VERSION}/query?q=${encodeURIComponent(query.trim())}`);
        const item={id:crypto.randomUUID(),owner:owner(conn,tab),object:name,prefix:schema.keyPrefix,deletable:schema.deletable,ids:new Set(),origin:conn.pageOrigin,orgLabel:conn.orgLabel,count:0,expires:now()+CACHE_TTL};
        const result=page(item,data);if(runs.size>=30)runs.delete(runs.keys().next().value);runs.set(item.id,item);return result;
    }
    async function more(conn,tab,id) {const run=getRun(conn,tab,id);if(run.busy)throw new Error('A query request is already running.');if(run.capped)throw new Error('The 10,000-row workspace limit was reached. Narrow the query.');if(!run.next)throw new Error('All query results are already loaded.');run.busy=true;try{return page(run,await request(conn,run.next));}finally{run.busy=false;}}
    function prepareDelete(conn,tab,id,ids) {
        const run=getRun(conn,tab,id);if(run.deleting)throw new Error('Deletion is already running.');if(!run.deletable)throw new Error('Salesforce does not allow deletion on this object.');
        if(!Array.isArray(ids) || !ids.length || ids.length>200 || new Set(ids).size!==ids.length || ids.some(id=>!run.ids.has(id)))throw new Error('Select up to 200 records with Id from this query result.');
        for(const [key,item] of tickets)if(item.runId===run.id)tickets.delete(key);
        const ticket=crypto.randomUUID();tickets.set(ticket,{owner:run.owner,runId:run.id,ids:[...ids],expires:now()+60000});
        return {ticket,count:ids.length,objectName:run.object,orgLabel:run.orgLabel,ids:[...ids]};
    }
    async function remove(conn,tab,ticket,confirmation) {
        prune();const item=tickets.get(ticket);if(!item || item.owner!==owner(conn,tab) || confirmation!=='DELETE')throw new Error('Confirm the selected records again before deleting.');
        const run=getRun(conn,tab,item.runId);if(run.deleting || item.ids.some(id=>!run.ids.has(id)))throw new Error('Selection changed. Confirm deletion again.');
        tickets.delete(ticket); // One use; never retry a destructive request automatically.
        run.deleting=true;run.next=null;
        try {const data=await request(conn,`/services/data/${API_VERSION}/composite/sobjects?ids=${encodeURIComponent(item.ids.join(','))}&allOrNone=false`,'DELETE');
        if(!Array.isArray(data) || data.length!==item.ids.length || data.some((result,index)=>result.id && result.id!==item.ids[index]))throw new Error('Delete outcome is unknown. Run the query again before retrying.');
        return {results:data.map((result,index)=>{const id=item.ids[index];if(result.success===true){run.ids.delete(id);return {id,success:true};}return {id,success:false,error:(result.errors || []).map(e=>String(e.statusCode || 'DELETE_FAILED').replace(/[^A-Z_]/g,'')).join(', ') || 'DELETE_FAILED'};})};} finally {run.deleting=false;}
    }
    return {objects,describe,run,more,prepareDelete,remove};
}
