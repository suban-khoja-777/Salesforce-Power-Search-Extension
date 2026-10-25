import {DEFAULT_DEBUG} from '../lib/admin-service.js';
let settings=structuredClone(DEFAULT_DEBUG);
const fields=[{name:'Id',label:'Account ID',type:'id',value:'001000000000001AAA',updateable:false},{name:'Name',label:'Account Name',type:'string',value:'Acme Corporation',updateable:true,nillable:false},{name:'Industry',label:'Industry',type:'picklist',value:'Technology',updateable:true,nillable:true,picklistValues:[{value:'Technology',label:'Technology'},{value:'Finance',label:'Finance'}]},{name:'AnnualRevenue',label:'Annual Revenue',type:'currency',value:1250000,updateable:true,nillable:true},{name:'Description',label:'Description',type:'textarea',value:'Sample record - preview only.',updateable:true,nillable:true},{name:'LastModifiedDate',label:'Last Modified Date',type:'datetime',value:'2026-10-15T08:00:00.000Z',updateable:false}];
export async function sampleAdminMessage(message){
    if(message.type==='RECORD_CONTEXT')return {ok:true,context:{objectName:'Account',id:'001000000000001AAA'}};
    if(message.type==='RECORD_GET')return {ok:true,objectName:'Account',id:'001000000000001AAA',snapshot:'sample',orgLabel:'Sample org',fields:structuredClone(fields)};
    if(message.type==='RECORD_SAVE'){for(const field of fields)if(Object.hasOwn(message.changes,field.name))field.value=message.changes[field.name];return {ok:true,saved:true};}
    if(message.type==='DEBUG_SETTINGS_SAVE')settings=structuredClone(message.settings);
    if(message.type==='DEBUG_SETTINGS_SAVE'||message.type==='DEBUG_SETTINGS_GET')return {ok:true,settings};
    if(message.type==='DEBUG_ENABLE')return {ok:true,expiration:new Date(Date.now()+settings.minutes*60000).toISOString(),warning:'Preview only: would enable logs for your user and open Salesforce Debug Logs.'};
    return {ok:false,error:'Unsupported preview operation.'};
}
