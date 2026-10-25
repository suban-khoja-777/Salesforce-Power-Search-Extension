import {validateQuery} from './records.js';
export function createQueryLibrary(storage) {
    const pending=new Map();
    const key=scope=>`query-library:v1:${scope}`;
    function clean(data={}) {
        data ||= {};
        const valid=item=>{try{return typeof item.id==='string'&&typeof item.name==='string'&&!!validateQuery(item.query,item.objectName);}catch{return false;}};
        const entries=list=>(Array.isArray(list)?list:[]).filter(valid).map(item=>({id:item.id,name:item.name.slice(0,80),objectName:item.objectName,query:item.query,time:Number(item.time)||0}));
        return {history:entries(data.history).slice(0,50),saved:entries(data.saved).slice(0,100)};
    }
    async function read(scope){return clean((await storage.get(key(scope)))[key(scope)]);}
    function mutate(scope,fn){const task=(pending.get(scope)||Promise.resolve()).catch(()=>{}).then(async()=>{const data=await read(scope);const result=fn(data);await storage.set({[key(scope)]:data});return result||data;});pending.set(scope,task);task.finally(()=>{if(pending.get(scope)===task)pending.delete(scope);}).catch(()=>{});return task;}
    function entry(objectName,query,name){validateQuery(query,objectName);return {id:crypto.randomUUID(),objectName,query:query.trim(),name:String(name||objectName).trim().slice(0,80)||objectName,time:Date.now()};}
    return {
        read:async scope=>{await pending.get(scope)?.catch(()=>{});return read(scope);},
        record:(scope,objectName,query)=>{const item=entry(objectName,query);return mutate(scope,data=>{data.history=[item,...data.history.filter(old=>old.query!==item.query||old.objectName!==objectName)].slice(0,50);});},
        save:(scope,{objectName,query,name,id})=>{const item=entry(objectName,query,name);return mutate(scope,data=>{if(id&&!data.saved.some(old=>old.id===id))throw new Error('Saved query no longer exists. Save a new copy.');if(!id&&data.saved.length>=100)throw new Error('Saved query limit reached (100). Remove an unused query first.');if(id)item.id=id;data.saved=[item,...data.saved.filter(old=>old.id!==item.id)];});},
        remove:(scope,id)=>mutate(scope,data=>{data.saved=data.saved.filter(item=>item.id!==id);}),
        clearHistory:scope=>mutate(scope,data=>{data.history=[];})
    };
}
