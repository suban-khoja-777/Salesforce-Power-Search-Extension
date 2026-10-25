import {initQueryWorkspace} from './query.js';

export function initQueryDesk({root,send,isPreview=false}) {
    const sessions=[];let active,closed=null,sequence=0,libraryMode='history',libraryData=null,libraryGeneration=0;
    const element=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;node.className=className;return node;};
    const original=element('section','','query-session');while(root.firstChild)original.append(root.firstChild);
    const template=original.cloneNode(true),toolbar=element('div','','query-desk-toolbar'),tabs=element('div','','query-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Open queries');
    const add=element('button','+ Query'),undo=element('button','Reopen closed'),history=element('button','History'),saved=element('button','Saved'),save=element('button','Save query'),message=element('span','','query-desk-status');message.setAttribute('role','status');
    const library=element('section','','query-library');library.hidden=true;library.setAttribute('aria-label','Query library');
    const heading=element('div','','query-actions'),title=element('strong','History'),clear=element('button','Clear history'),dismiss=element('button','Close library'),filter=element('input');filter.type='search';filter.placeholder='Find queries…';filter.setAttribute('aria-label','Find queries');heading.append(title,filter,clear,dismiss);
    const saveForm=element('form','','query-save-form');saveForm.hidden=true;const name=element('input'),submit=element('button','Save'),cancel=element('button','Cancel');name.placeholder='Query name';name.maxLength=80;name.required=true;name.setAttribute('aria-label','Query name');submit.type='submit';cancel.type='button';saveForm.append(name,submit,cancel);
    const items=element('div','','query-library-items');library.append(heading,items);toolbar.append(tabs,add,undo,history,saved,save);root.append(toolbar,saveForm,message,library);
    async function request(data){const response=await send(data);if(!response?.ok)throw new Error(response?.error||'Query library unavailable.');return response;}
    const locked=()=>sessions.some(session=>session.workspace?.state.review);
    function renderTabs(){
        tabs.replaceChildren(...sessions.map((session,index)=>{const group=element('div','','query-tab-group'),button=element('button',session.name||`${session.workspace?.state.schema?.name||'Query'} ${session.number}`),close=element('button','×');button.id=`query-tab-${session.id}`;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(session===active));button.setAttribute('aria-controls',session.root.id);button.tabIndex=session===active?0:-1;button.onclick=()=>activate(session);button.onkeydown=event=>{if(!event.ctrlKey&&!event.altKey&&['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?sessions[0]:event.key==='End'?sessions.at(-1):sessions[(index+(event.key==='ArrowRight'?1:-1)+sessions.length)%sessions.length];activate(target);document.getElementById(`query-tab-${target.id}`)?.focus();}};close.setAttribute('aria-label',`Close ${button.textContent}`);close.disabled=!!session.workspace?.state.busy||locked();close.onclick=()=>{if(close.disabled)return;const position=sessions.indexOf(session);sessions.splice(position,1);session.workspace.close();session.root.remove();closed=session;if(session===active){active=null;if(sessions.length)activate(sessions[Math.min(position,sessions.length-1)]);else create();}renderTabs();};group.append(button,close);return group;}));
        add.disabled=sessions.length>=8||locked();undo.hidden=!closed;undo.disabled=sessions.length>=8||locked();save.disabled=!active?.workspace?.state.schema||active.workspace.state.busy||locked();
    }
    function activate(session){if(locked())return;active=session;for(const item of sessions)item.root.hidden=item!==session;saveForm.hidden=true;renderTabs();session.workspace?.open();session.workspace?.editor.focus();}
    function create(item){
        if(sessions.length>=8||locked()){message.textContent='Close a query tab before opening another (maximum 8).';return null;}
        const id=String(++sequence),panel=sequence===1?original:template.cloneNode(true);panel.id=`query-session-${id}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`query-tab-${id}`);
        if(sequence>1){panel.dataset.querySuffix=id;for(const node of panel.querySelectorAll('[id]'))node.id+=`-${id}`;for(const node of panel.querySelectorAll('[for],[aria-controls],[aria-labelledby],[aria-describedby]'))for(const attr of ['for','aria-controls','aria-labelledby','aria-describedby'])if(node.hasAttribute(attr))node.setAttribute(attr,node.getAttribute(attr).split(' ').map(value=>`${value}-${id}`).join(' '));}
        root.append(panel);const session={id,number:sequence,root:panel,workspace:null,name:item?.name||'',savedId:libraryMode==='saved'?item?.id:null};sessions.push(session);
        session.workspace=initQueryWorkspace({root:panel,send,isPreview,onChange:renderTabs,onExecuted:()=>{if(!library.hidden&&libraryMode==='history')loadLibrary();}});
        activate(session);if(item)session.workspace.restore(item).then(()=>{if(session===active&&!root.hidden)session.workspace.editor.focus();});return session;
    }
    function setLibraryVisible(visible){
        library.hidden=!visible;
        for(const [button,mode] of [[history,'history'],[saved,'saved']]){button.setAttribute('aria-expanded',String(visible&&libraryMode===mode));button.setAttribute('aria-pressed',String(visible&&libraryMode===mode));}
        if(!visible)libraryGeneration++;
    }
    function renderLibrary(){
        if(!libraryData)return;
        const term=filter.value.toLowerCase(),entries=libraryData[libraryMode]||[];
        items.replaceChildren(...entries.filter(item=>`${item.name} ${item.objectName} ${item.query}`.toLowerCase().includes(term)).map(item=>{
            const row=element('div','','query-library-row'),open=element('button',`${item.name} · ${item.objectName}`),query=element('code',item.query),time=element('small',new Date(item.time).toLocaleString());
            open.title='Open in a new query tab';open.onclick=()=>{if(create(item))setLibraryVisible(false);};row.append(open,time,query);
            if(libraryMode==='saved'){const remove=element('button','Remove');remove.onclick=async()=>{remove.disabled=true;try{await request({type:'QUERY_LIBRARY_REMOVE',id:item.id});for(const session of sessions)if(session.savedId===item.id)session.savedId=null;if(!library.hidden)await loadLibrary();}catch(error){message.textContent=error.message;remove.disabled=false;}};row.append(remove);}return row;
        }));if(!items.children.length)items.append(element('p','No matching queries.'));
    }
    async function loadLibrary(){
        const generation=++libraryGeneration;setLibraryVisible(true);title.textContent=libraryMode==='saved'?'Saved queries':'Query history';clear.hidden=libraryMode!=='history';items.replaceChildren(element('p','Loading…'));
        try{const data=await request({type:'QUERY_LIBRARY_GET'});if(generation!==libraryGeneration)return;libraryData=data;renderLibrary();}catch(error){if(generation===libraryGeneration)items.replaceChildren(element('p',error.message));}
    }
    function toggleLibrary(mode){if(!library.hidden&&libraryMode===mode){setLibraryVisible(false);return;}libraryMode=mode;loadLibrary();}
    setLibraryVisible(false);
    add.onclick=()=>create();undo.onclick=()=>{if(!closed||undo.disabled)return;const session=closed;closed=null;sessions.push(session);root.append(session.root);activate(session);};
    history.onclick=()=>toggleLibrary('history');saved.onclick=()=>toggleLibrary('saved');filter.oninput=renderLibrary;dismiss.onclick=()=>setLibraryVisible(false);clear.onclick=async()=>{clear.disabled=true;try{await request({type:'QUERY_HISTORY_CLEAR'});if(!library.hidden)await loadLibrary();}catch(error){message.textContent=error.message;}finally{clear.disabled=false;}};
    save.onclick=()=>{saveForm.hidden=false;name.value=active.name||`${active.workspace.state.schema.name} query`;name.focus();name.select();};cancel.onclick=()=>{saveForm.hidden=true;};
    saveForm.onsubmit=async event=>{event.preventDefault();const session=active;if(!session?.workspace.state.schema)return;submit.disabled=true;try{const query=session.workspace.editor.value,data=await request({type:'QUERY_LIBRARY_SAVE',id:session.savedId,objectName:session.workspace.state.schema.name,query,name:name.value});const item=data.saved.find(item=>item.query===query.trim()&&item.name===name.value.trim());session.savedId=item?.id;session.name=item?.name||name.value;saveForm.hidden=true;message.textContent='Query saved on this browser for this org.';renderTabs();if(!library.hidden)loadLibrary();}catch(error){message.textContent=error.message;}finally{submit.disabled=false;}};
    // Initialize lazily so opening Search does not start Salesforce query requests.
    return {get state(){return active?.workspace.state||{};},get sessions(){return sessions;},get editor(){return active?.workspace.editor;},open(){if(!active)create();else active.workspace.open();active?.workspace.editor.focus();},close(){active?.workspace.close();},root};
}
