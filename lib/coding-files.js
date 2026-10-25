import {zipSync,unzipSync,strToU8,strFromU8} from '../vendor/zip.js';
import {escapeXml} from './metadata.js';

export const CODE_TYPES={apex:{label:'Classes',xml:'ApexClass',folder:'classes',suffix:'cls',object:'ApexClass',nameField:'Name'},trigger:{label:'Triggers',xml:'ApexTrigger',folder:'triggers',suffix:'trigger',object:'ApexTrigger',nameField:'Name'},lwc:{label:'LWC',xml:'LightningComponentBundle',folder:'lwc',object:'LightningComponentBundle',nameField:'DeveloperName'}};
export const MAX_SOURCE_BYTES=4*1024*1024;
export function componentKey(item){return `${item.type}:${item.name}`;}
export function validComponent(item){return Boolean(CODE_TYPES[item?.type]&&/^[A-Za-z][A-Za-z0-9_]*$/.test(item?.name)&&!item.name.includes('__'));}
export function fileOwner(path,members){
    if(typeof path!=='string'||path.length>250||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..')||!/^[A-Za-z0-9_./-]+$/.test(path))return null;
    return members.find(item=>{
        const kind=CODE_TYPES[item.type];
        return kind&&validComponent(item)&&(item.type==='lwc'?path.startsWith(`lwc/${item.name}/`)&&/\.(?:js|html|css|svg|xml|json)$/.test(path):[`${kind.folder}/${item.name}.${kind.suffix}`,`${kind.folder}/${item.name}.${kind.suffix}-meta.xml`].includes(path));
    })||null;
}
export function packageXml(members){
    return `<?xml version="1.0" encoding="UTF-8"?><Package xmlns="http://soap.sforce.com/2006/04/metadata">${Object.entries(CODE_TYPES).map(([type,kind])=>{const names=members.filter(m=>m.type===type);return names.length?`<types>${names.map(m=>`<members>${escapeXml(m.name)}</members>`).join('')}<name>${kind.xml}</name></types>`:'';}).join('')}<version>65.0</version></Package>`;
}
export function validateFiles(files,members,expectedPaths){
    if(!files||typeof files!=='object'||Array.isArray(files)||!members.length||members.some(m=>!validComponent(m)))throw new Error('Invalid code project.');
    const paths=Object.keys(files);let bytes=0;
    if(!paths.length||paths.length>10000)throw new Error('Project contains no files or too many files.');
    for(const path of paths){if(!fileOwner(path,members)||typeof files[path]!=='string')throw new Error('Unsupported code file path.');bytes+=strToU8(files[path]).length;}
    if(bytes>MAX_SOURCE_BYTES)throw new Error('Code workspace exceeds the 4 MB source limit. Open a smaller component.');
    if(expectedPaths&&(paths.length!==expectedPaths.length||expectedPaths.some(p=>!Object.hasOwn(files,p))))throw new Error('Files cannot be added or deleted during this save. Reload the component.');
    for(const item of members){const kind=CODE_TYPES[item.type],base=`${kind.folder}/${item.name}`;
        const required=item.type==='lwc'?[`${base}/${item.name}.js-meta.xml`]:[`${base}.${kind.suffix}`,`${base}.${kind.suffix}-meta.xml`];
        if(required.some(path=>!Object.hasOwn(files,path)))throw new Error(`Incomplete ${item.name} component. Reload before saving.`);
    }
    return files;
}
export function fromBase64(text){if(typeof text!=='string'||text.length>12*1024*1024)throw new Error('Code download exceeds the ZIP size limit.');return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
export function toBase64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
export function unpackProject(base64,members){
    let total=0;
    const archive=unzipSync(fromBase64(base64),{filter:file=>{total+=file.originalSize;if(total>MAX_SOURCE_BYTES+1024*1024)throw new Error('Retrieved project exceeds the source limit.');return true;}});
    const files=Object.create(null);
    for(const [raw,bytes] of Object.entries(archive)){
        const path=raw.replace(/^unpackaged\//,'');
        if(path==='package.xml'||path.endsWith('/'))continue;
        if(!fileOwner(path,members)||Object.hasOwn(files,path))throw new Error('Salesforce returned an unexpected code file.');
        files[path]=strFromU8(bytes);
    }
    return validateFiles(files,members);
}
export function projectZip(files,members){validateFiles(files,members);return zipSync(Object.fromEntries([...Object.entries(files).map(([path,text])=>[path,strToU8(text)]),['package.xml',strToU8(packageXml(members))]]),{level:6});}
export async function fileHashes(files){return Object.fromEntries(await Promise.all(Object.entries(files).map(async([path,text])=>[path,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',strToU8(text))),b=>b.toString(16).padStart(2,'0')).join('')])));}
export function hashesEqual(a,b){return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>a[key]===b[key]);}
