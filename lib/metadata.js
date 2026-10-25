import { localEntries } from './visibility.js';
import { XMLParser, XMLValidator } from '../vendor/xml-parser.js';
import { categoryForMetadata, mergeCatalog } from './catalog.js';
const VERSION = '65.0';
const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
export const escapeXml = (value) => String(value).replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);

export function soapEnvelope(operation, token, queries = []) {
    if (!['describeMetadata', 'listMetadata'].includes(operation)) throw new Error('Unsupported metadata operation.');
    if (queries.length > 3) throw new Error('A metadata request supports at most three queries.');
    const body = operation === 'describeMetadata' ? `<asOfVersion>${VERSION}</asOfVersion>`
        : queries.map(({ type, folder }) => `<queries><type>${escapeXml(type)}</type>${folder == null ? '' : `<folder>${escapeXml(folder)}</folder>`}</queries>`).join('') + `<asOfVersion>${VERSION}</asOfVersion>`;
    return `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns="http://soap.sforce.com/2006/04/metadata"><env:Header><SessionHeader><sessionId>${escapeXml(token)}</sessionId></SessionHeader></env:Header><env:Body><${operation}>${body}</${operation}></env:Body></env:Envelope>`;
}

export function parseSoap(text, operation) {
    // Never process DTDs/entities supplied by a response. Standard XML entities remain supported.
    if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('Salesforce returned invalid metadata XML.');
    const document = new XMLParser({ removeNSPrefix: true, parseTagValue: false, ignoreAttributes: true }).parse(text);
    const body = document.Envelope?.Body;
    if (body?.Fault) {
        const code = String(body.Fault.faultcode || 'SOAP_FAULT').replace(/[^A-Za-z0-9_:]/g, '');
        // Fault text could contain echoed session data: only expose the fault code.
        throw new Error(`Salesforce Metadata API rejected this request (${code}). Check metadata permissions and session access.`);
    }
    const response = body?.[`${operation}Response`];
    if (!body || !Object.hasOwn(body, `${operation}Response`)) throw new Error('Salesforce returned an unexpected metadata response.');
    return response.result === '' ? undefined : response.result;
}

export async function discoverCatalog(soap) {
    const result = await soap('describeMetadata');
    const discovered = array(result?.metadataObjects).map((type) => ({
        xmlName: type.xmlName, inFolder: type.inFolder === 'true' || type.inFolder === true,
        childXmlNames: array(type.childXmlNames)
    }));
    return mergeCatalog(discovered);
}

export function metadataEntry(file, descriptor) {
    const fullName = String(file.fullName || '');
    if (!fullName) throw new Error('A metadata listing returned an item without a name.');
    const parts = fullName.split('.');
    return {
        id: String(file.id || fullName), type: descriptor.key, label: fullName.split('/').at(-1), apiName: fullName,
        manageableState: file.manageableState || null, metadataType: descriptor.metadataType, namespace: file.namespacePrefix || null,
        parentObject: ['field', 'validation', 'recordtype', 'fieldset', 'compactlayout'].includes(descriptor.key) ? parts[0] : null,
        createdDate:file.createdDate||null, createdBy:file.createdByName||file.createdById||null,
        lastModifiedDate:file.lastModifiedDate||null, lastModifiedBy:file.lastModifiedByName||file.lastModifiedById||null,
        navigationHint: null
    };
}

export async function listMetadataCategory(descriptor, soap) {
    const warnings = [], entries = [];
    const deadline = Date.now() + 90000;
    const list = async (type, folder) => {
        const records = array(await soap('listMetadata', [{ type, folder }]));
        if (records.length >= 1000) warnings.push(`${type}${folder ? ` / ${folder}` : ''}: reached Salesforce's 1,000-item listing limit; results may be incomplete.`);
        return records;
    };
    if (!descriptor.inFolder) {
        entries.push(...(await list(descriptor.metadataType)).map((file) => metadataEntry(file, descriptor)));
    } else {
        const folderType = { EmailTemplate: 'EmailFolder', Report: 'ReportFolder', Dashboard: 'DashboardFolder', Document: 'DocumentFolder' }[descriptor.metadataType];
        if (!folderType) throw new Error(`Folder enumeration for ${descriptor.metadataType} is not supported by this API adapter.`);
        const folders = await list(folderType);
        const names = new Set(folders.map((folder) => folder.fullName).filter(Boolean));
        if (['EmailTemplate', 'Report', 'Document'].includes(descriptor.metadataType)) names.add('unfiled$public');
        if (names.size > 200) warnings.push(`${descriptor.label}: only the first 200 folders were indexed. Narrow the catalog in a future object/folder-scoped search.`);
        for (const folder of [...names].slice(0, 200)) {
            if (Date.now() > deadline) { warnings.push(`${descriptor.label}: the folder-listing time limit was reached; results are incomplete.`); break; }
            try { entries.push(...(await list(descriptor.metadataType, folder)).map((file) => metadataEntry(file, descriptor))); }
            catch { warnings.push(`${descriptor.label}: folder ${folder} could not be listed. Check folder access.`); }
        }
    }
    const unique = [...new Map(entries.map((entry) => [`${entry.type}:${entry.apiName}`, entry])).values()];
    return { entries: localEntries(unique), warnings };
}
