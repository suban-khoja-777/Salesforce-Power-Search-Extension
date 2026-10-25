import {monaco,setComponentNames} from '../vendor/editor.js';
import {CODE_TYPES,componentKey,projectZip,packageXml} from '../lib/coding-files.js';
import {createLocalProject} from './coding-local.js';
const $=selector=>document.querySelector(selector),preview=location.protocol!=='chrome-extension:';
const send=async message=>{const result=preview?await (await import('./coding-sample.js')).sampleCoding(message):await chrome.runtime.sendMessage(message);if(!result?.ok)throw new Error(result?.error||'The extension connection was lost. Reload Power Search.');return result;};
const local=createLocalProject(),components=new Map(),models=new Map();
let members=[],orgKey='',active=null,busy=false,pending=null,editor;
const status=text=>{$('#message').textContent=text;};
const dirty=component=>Object.entries(component.files).some(([path,text])=>models.get(path)?.getValue()!==text);
function current(){return active&&[...components.values()].find(c=>Object.hasOwn(c.files,active));}
function values(component){return Object.fromEntries(Object.keys(component.files).map(path=>[path,models.get(path).getValue()]));}
function language(path){return path.endsWith('.cls')||path.endsWith('.trigger')?'apex':path.endsWith('.js')?'javascript':path.endsWith('.html')?'html':path.endsWith('.css')?'css':path.endsWith('.json')?'json':'xml';}
function button(label,action,className){const b=document.createElement('button');b.textContent=label;b.onclick=action;if(className)b.className=className;return b;}
function controls(){const component=current(),locked=busy||Boolean(pending);$('#save').disabled=locked||!component||!dirty(component)||component.invalid;$('#save-all').disabled=locked||![...components.values()].some(c=>dirty(c)&&!c.invalid);for(const id of ['reload','download','find'])$(`#${id}`).disabled=locked||!component;for(const id of ['refresh','export','folder'])$(`#${id}`).disabled=locked;$('#project-folder').disabled=locked||!local.name;$('#sync').disabled=locked||!local.name;editor?.updateOptions({readOnly:locked});}
function renderTabs(){
    const bar=$('#tabs'),focused=document.activeElement?.dataset?.path;bar.replaceChildren();
    for(const [path,model] of models){const c=[...components.values()].find(c=>Object.hasOwn(c.files,path)),changed=model.getValue()!==c.files[path],wrap=document.createElement('div');wrap.classList.toggle('selected',active===path);
        const tab=button(`${changed?'● ':''}${path.split('/').at(-1)}`,()=>activate(path));tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(active===path));tab.title=path;tab.dataset.path=path;tab.tabIndex=active===path?0:-1;
        const close=button('×',()=>closeComponent(c),'close-tab');close.title=`Close ${c.member.name} component`;close.setAttribute('aria-label',close.title);wrap.append(tab,close);bar.append(wrap);
    }
    if(focused)[...bar.querySelectorAll('[data-path]')].find(b=>b.dataset.path===focused)?.focus();controls();
}
function activate(path){active=path;$('#welcome').hidden=true;$('#editor').hidden=false;editor.setModel(models.get(path));$('#breadcrumb').textContent=path;$('#language').textContent=`${language(path)} · UTF-8`;renderTabs();editor.layout();editor.focus();}
function closeComponent(c){if(busy||pending)return;if(dirty(c)&&!confirm(`Discard unsaved edits in ${c.member.name} and close its files?`))return;for(const path of Object.keys(c.files)){models.get(path)?.dispose();models.delete(path);}components.delete(componentKey(c.member));if(!models.has(active)){active=null;editor.setModel(null);if(models.size)activate(models.keys().next().value);else{$('#editor').hidden=true;$('#welcome').hidden=false;$('#breadcrumb').textContent='Select a component to start';}}renderTabs();renderTree();}
function install(result){
    for(const member of result.members){const prefix=CODE_TYPES[member.type].folder+'/'+member.name,files=Object.fromEntries(Object.entries(result.files).filter(([path])=>member.type==='lwc'?path.startsWith(prefix+'/'):path.startsWith(prefix+'.')));
        const previous=components.get(componentKey(member));if(previous)for(const path of Object.keys(previous.files))if(!Object.hasOwn(files,path)){models.get(path)?.dispose();models.delete(path);}
        const c={member,files,snapshot:result.snapshot};components.set(componentKey(member),c);
        for(const [path,text] of Object.entries(files)){const old=models.get(path);if(old){old.setValue(text);}else{const model=monaco.editor.createModel(text,language(path),monaco.Uri.parse(`file:///${path}`));model.onDidChangeContent(()=>{controls();const tab=[...$('#tabs').querySelectorAll('[data-path]')].find(b=>b.dataset.path===path);if(tab)tab.textContent=`${model.getValue()!==components.get(componentKey(member)).files[path]?'● ':''}${path.split('/').at(-1)}`;});models.set(path,model);}}
    }
    renderTree();activate(Object.keys(result.files).find(p=>!p.endsWith('.xml'))||Object.keys(result.files)[0]);
}
function renderTree(){
    const tree=$('#tree'),query=$('#component-filter').value.toLowerCase();tree.replaceChildren();
    for(const [type,kind] of Object.entries(CODE_TYPES)){const group=document.createElement('details');group.open=true;const matches=members.filter(m=>m.type===type&&m.name.toLowerCase().includes(query)),summary=document.createElement('summary');summary.textContent=`${kind.label}  ${matches.length}`;group.append(summary);
        for(const member of matches){const c=components.get(componentKey(member)),row=button(`${type==='apex'?'C':type==='trigger'?'T':'◇'}  ${member.name}`,()=>open(member));row.title=`Open ${member.name}`;group.append(row);
            if(c)for(const path of Object.keys(c.files)){const file=button(path.split('/').at(-1),()=>activate(path),'file-button');file.title=path;group.append(file);}
        }tree.append(group);
    }
}
async function operation(work){if(busy)return;busy=true;controls();try{return await work();}catch(error){status(error.message);}finally{busy=false;controls();}}
async function poll(job){
    for(let attempt=0;attempt<900;attempt++){const result=await send({type:'CODE_POLL',job});if(result.done)return result;status(`${result.status||'Working'}${result.deploymentId?` · ${result.deploymentId}`:''}…`);await new Promise(resolve=>setTimeout(resolve,2000));}
    throw new Error('Operation is still running. Use Check pending operation to continue.');
}
async function runJob(message,kind,component){
    const started=await send(message);pending={job:started.job,kind,key:component&&componentKey(component.member)};sessionStorage.setItem('coding-pending',JSON.stringify(pending));$('#resume').hidden=true;
    try{const result=await poll(started.job);pending=null;sessionStorage.removeItem('coding-pending');if(result.failed){if(component)component.invalid=true;throw new Error(result.error);}return result;}catch(error){$('#resume').hidden=!pending;throw error;}
}
async function open(member,force=false){
    if(busy||pending)return;const existing=components.get(componentKey(member));if(existing&&!force){activate(Object.keys(existing.files)[0]);return;}
    if(force&&existing&&dirty(existing)&&!confirm(`Discard unsaved edits and reload ${member.name} from Salesforce?`))return;
    await operation(async()=>{status(`Retrieving ${member.name}…`);const result=await runJob({type:'CODE_OPEN',selection:member},'open');install(result);status(`Loaded ${member.name}. ${preview?'Sample mode.':'Ready to edit.'}`);});
}
function download(files,selected,filename){const url=URL.createObjectURL(new Blob([projectZip(files,selected)],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function showErrors(errors){$('#problems').replaceChildren();for(const model of models.values())monaco.editor.setModelMarkers(model,'salesforce',[]);for(const error of errors||[]){const path=error.path.replace(/^unpackaged\//,''),row=document.createElement('li');row.append(button(`${path?`${path}:${error.line} `:''}${error.message}`,()=>{if(models.has(path)){activate(path);editor.revealLineInCenter(error.line);editor.setPosition({lineNumber:error.line,column:error.column});}}));$('#problems').append(row);if(models.has(path)){const model=models.get(path),prior=monaco.editor.getModelMarkers({owner:'salesforce',resource:model.uri});monaco.editor.setModelMarkers(model,'salesforce',[...prior,{message:error.message,severity:monaco.MarkerSeverity.Error,startLineNumber:error.line,endLineNumber:error.line,startColumn:error.column,endColumn:error.column+1}]);}}}
async function finishSave(c,result,files,sync){
    showErrors(result.errors);if(!result.saved){c.snapshot=result.snapshot;c.invalid=!result.snapshot;throw new Error('Deployment failed. Edits are retained. Fix the reported problems and save again.');}
    c.files=files;c.snapshot=result.snapshot;c.invalid=false;renderTabs();
    if(sync){try{const count=await local.save(files);status(`Salesforce saved successfully. Local sync complete: ${count} files.`);}catch(error){$('#sync').checked=false;$('#sync-status').textContent='Local sync needs attention';throw new Error(`Salesforce saved successfully; local sync FAILED. ${error.message} Use Download edits to preserve this version.`);}}
    else status(`${preview?'Sample save complete':'Salesforce deployment succeeded'}. Local sync is off.${result.deploymentId?` Deployment: ${result.deploymentId}`:''}`);
}
async function saveComponent(c){
    const files=values(c),sync=$('#sync').checked;if(sync)await local.preflight(files);status(`Saving ${c.member.name}: checking the latest Salesforce source…`);showErrors([]);
    const result=await runJob({type:'CODE_SAVE',snapshot:c.snapshot,files},'save',c);await finishSave(c,result,files,sync);
}
async function refresh(){const result=await send({type:'CODE_CATALOG'});members=result.members;orgKey=result.orgKey;$('#org').textContent=result.orgLabel;$('#connection').textContent=preview?'Sample preview':result.orgLabel;setComponentNames(members.filter(m=>m.type==='apex').map(m=>m.name));renderTree();}
async function exportProject(toFolder){
    await operation(async()=>{status('Retrieving all local Classes, Triggers and LWC from Salesforce…');const result=await runJob({type:'CODE_OPEN',selection:'all'},toFolder?'folder':'export');if(toFolder){const count=await local.save({...result.files,'package.xml':packageXml(result.members)});status(`Saved ${count} project files to ${local.name}. You can now enable local sync.`);}else{download(result.files,result.members,'power-search-project.zip');status('Downloaded the Salesforce project snapshot. Unsaved editor changes are available through Download edits.');}});
}
editor=monaco.editor.create($('#editor'),{theme:'vs-dark',automaticLayout:true,fontSize:13,fontFamily:"'Cascadia Code', Consolas, monospace",minimap:{enabled:false},scrollBeyondLastLine:false,tabSize:4,insertSpaces:true,padding:{top:12},wordWrap:'off',smoothScrolling:true,bracketPairColorization:{enabled:true},ariaLabel:'Source code editor'});
editor.onDidChangeCursorPosition(event=>{$('#position').textContent=`Ln ${event.position.lineNumber}, Col ${event.position.column}`;});
$('#component-filter').oninput=renderTree;
$('#refresh').onclick=()=>operation(refresh);
$('#save').onclick=()=>operation(()=>saveComponent(current()));
$('#save-all').onclick=()=>operation(async()=>{for(const c of components.values())if(dirty(c)&&!c.invalid)await saveComponent(c);});
$('#reload').onclick=()=>open(current().member,true);
$('#download').onclick=()=>{const c=current();download(values(c),[c.member],`${c.member.name}-edits.zip`);};
$('#export').onclick=()=>exportProject(false);
$('#project-folder').onclick=()=>exportProject(true);
$('#folder').onclick=async()=>{try{if(!window.showDirectoryPicker)throw new Error('Local folder sync requires desktop Chrome or Edge. Use project ZIP export in this browser.');const handle=await window.showDirectoryPicker({mode:'readwrite',id:'power-search-code'});await local.connect(handle,orgKey);$('#folder-state').textContent=local.name;$('#sync').checked=false;$('#sync-status').textContent='Local sync off';status('Folder connected. Save the whole project here before enabling sync. Existing different files will not be overwritten.');controls();}catch(error){if(error.name!=='AbortError')status(error.message);}};
$('#sync').onchange=()=>{$('#sync-status').textContent=$('#sync').checked?`Sync to ${local.name}`:'Local sync off';status($('#sync').checked?'Editor saves will deploy to Salesforce, then write this component to the selected folder.':'Local sync disabled.');};
$('#theme').onclick=()=>{const light=document.body.classList.toggle('light');monaco.editor.setTheme(light?'vs':'vs-dark');$('#theme').textContent=light?'Dark theme':'Light theme';};
$('#wrap').onclick=()=>{const enabled=$('#wrap').getAttribute('aria-pressed')!=='true';$('#wrap').setAttribute('aria-pressed',String(enabled));editor.updateOptions({wordWrap:enabled?'on':'off'});};
$('#find').onclick=()=>editor.getAction('actions.find').run();
$('#tabs').onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const paths=[...models.keys()],index=paths.indexOf(active);activate(event.key==='Home'?paths[0]:event.key==='End'?paths.at(-1):paths[(index+(event.key==='ArrowRight'?1:-1)+paths.length)%paths.length]);}};
document.addEventListener('keydown',event=>{if(!(event.ctrlKey||event.metaKey))return;if(event.key.toLowerCase()==='s'){event.preventDefault();if(!busy&&!pending){const c=current();if(event.shiftKey)$('#save-all').click();else if(c&&dirty(c)&&!c.invalid)$('#save').click();}}if(event.key.toLowerCase()==='p'){event.preventDefault();$('#component-filter').focus();$('#component-filter').select();}});
window.addEventListener('beforeunload',event=>{if(busy||pending||[...components.values()].some(dirty)){event.preventDefault();event.returnValue='';}});
$('#resume').onclick=()=>operation(async()=>{if(!pending)return;const task=pending;const result=await poll(task.job);pending=null;sessionStorage.removeItem('coding-pending');$('#resume').hidden=true;if(result.failed){const c=components.get(task.key);if(c)c.invalid=true;throw new Error(result.error);}if(task.kind==='open')install(result);else if(task.kind==='save'){const c=components.get(task.key);if(c)await finishSave(c,result,values(c),$('#sync').checked);else{showErrors(result.errors);status(result.saved?'Salesforce saved. Reopen the component and save the project folder to update local files.':'Deployment failed. Review the errors.');}}else if(task.kind==='export')download(result.files,result.members,'power-search-project.zip');else status('Retrieval complete. Choose a folder and use Save whole project to folder again.');});
try{pending=JSON.parse(sessionStorage.getItem('coding-pending')||'null');}catch{}
$('#stop-checking').onclick=()=>{if(busy||!pending)return;if(!confirm('This only stops monitoring. It does NOT cancel a Salesforce deployment. Check Setup > Deployment Status before reloading or saving again. Continue?'))return;const c=components.get(pending.key);if(c)c.invalid=true;pending=null;sessionStorage.removeItem('coding-pending');$('#resume').hidden=true;$('#stop-checking').hidden=true;status('Monitoring stopped. Download any edits, check Salesforce Deployment Status, then reload the component.');controls();};
new MutationObserver(()=>{$('#stop-checking').hidden=$('#resume').hidden;}).observe($('#resume'),{attributes:true,attributeFilter:['hidden']});
if(pending){$('#resume').hidden=false;status('An operation was pending. Check its status before starting another save.');}
await operation(refresh);
