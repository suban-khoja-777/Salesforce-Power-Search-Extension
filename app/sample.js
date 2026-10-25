import { COMMON_TYPES, CORE_TYPES, RECENT_TYPES } from '../lib/catalog.js';
export const sampleIndex = [
    ['apex', 'AccountService'], ['apex', 'AccountTriggerHandler'], ['apex', 'ContactController'],
    ['object', 'Account', 'Accounts'], ['object', 'Contact', 'Contacts'], ['object', 'Opportunity', 'Opportunities'],
    ['trigger', 'AccountTrigger'], ['apex', 'AccountServiceTest'], ['apex', 'InvoiceService'],
    ['object', 'Invoice__c', 'Invoices'], ['apex', 'BillingService', null, 'billing'], ['trigger', 'OpportunityTrigger']
].map(([type, name, label, namespace], i) => ({ type, label: label || name, apiName: namespace ? `${namespace}__${name}` : name, namespace, id: type === 'object' ? name : `${type === 'apex' ? '01p' : '01q'}${String(i + 1).padStart(12, '0')}AAA` }));
for (const [index, descriptor] of COMMON_TYPES.filter((type) => !CORE_TYPES.includes(type.key) && !RECENT_TYPES.includes(type.key) && type.key !== 'user').entries()) {
    const names = { flow: 'Account_Onboarding', lwc: 'accountSearch', aura: 'AccountPanel', field: 'Account.Customer_Tier__c', validation: 'Account.Require_Customer_Tier', layout: 'Account-Account Layout', recordtype: 'Account.Enterprise', report: 'Sales/Account_Pipeline', dashboard: 'Sales/Account_Overview', label: 'Account_Search_Title', permissionset: 'Power_Search_User' };
    const name = names[descriptor.key] || `Account_${descriptor.metadataType}`;
    sampleIndex.push({ id: descriptor.key === 'flow' ? '301000000000001AAA' : `0ZZ${String(index + 1).padStart(12, '0')}AAA`, type: descriptor.key, label: name.split('/').at(-1), apiName: name, metadataType: descriptor.metadataType,
        parentObject: ['field', 'validation', 'recordtype', 'fieldset', 'compactlayout', 'layout'].includes(descriptor.key) ? 'Account' : null });
}

sampleIndex.push({ id: "500000000000001AAA", type: "recentrecord", recordType: "Case", label: "RFQ intake request", apiName: "Case · RFQ intake request", recentRank: 0 });
sampleIndex.push({ id: "001000000000001AAA", type: "recentrecord", recordType: "Account", label: "Acme Corporation", apiName: "Account · Acme Corporation", recentRank: 1 });
sampleIndex.push({ ...sampleIndex[0], type: "recentcomponent", targetType: "apex", recentRank: 0 });

sampleIndex.push({type:"user",id:"005000000000001AAA",label:"Alex Morgan",apiName:"alex.morgan@example.test",isActive:true});
sampleIndex.push({type:"user",id:"005000000000002AAA",label:"Taylor Reed",apiName:"taylor.reed@example.test",isActive:false});

for(const entry of sampleIndex)Object.assign(entry,{createdDate:"2026-09-10T09:30:00Z",createdBy:"Alex Morgan",lastModifiedDate:"2026-10-14T10:15:00Z",lastModifiedBy:"Taylor Reed"});
