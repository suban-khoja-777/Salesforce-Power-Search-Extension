// Workspace order comes from the tab bar, so adding tabs needs no shortcut changes.
export function initWorkspaceTabs({tablist,hooks={},canSwitch=()=>true}) {
    const tabs=()=>[...tablist.querySelectorAll('[role=tab][data-workspace]')].filter(tab=>!tab.disabled&&!tab.hidden);
    const panel=tab=>document.getElementById(tab.getAttribute('aria-controls'));
    let active=tabs().find(tab=>tab.getAttribute('aria-selected')==='true')||tabs()[0];
    function activate(tab,focusTab=false){
        if(!tab||!panel(tab)||!canSwitch())return;
        if(active!==tab)hooks[active?.dataset.workspace]?.close?.();
        active=tab;document.body.dataset.workspace=tab.dataset.workspace;
        for(const item of tablist.querySelectorAll('[role=tab][data-workspace]')){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;if(panel(item))panel(item).hidden=!selected;}
        hooks[tab.dataset.workspace]?.open?.();
        if(focusTab)tab.focus();else (hooks[tab.dataset.workspace]?.focus?.()||tab).focus();
        tab.scrollIntoView?.({block:'nearest',inline:'nearest'});
    }
    tablist.addEventListener('click',event=>{const tab=event.target.closest('[role=tab][data-workspace]');if(tab&&tablist.contains(tab))activate(tab);});
    tablist.addEventListener('keydown',event=>{
        if(event.altKey||event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const all=tabs(),index=all.indexOf(active);
        activate(event.key==='Home'?all[0]:event.key==='End'?all.at(-1):all[(index+(event.key==='ArrowRight'?1:-1)+all.length)%all.length],true);
    });
    document.addEventListener('keydown',event=>{
        if(event.isComposing||!event.ctrlKey||event.metaKey||event.shiftKey)return;
        const all=tabs(),index=all.indexOf(active);let target;
        if(!event.altKey&&(event.key==='ArrowRight'||event.key==='ArrowLeft'))target=all[(index+(event.key==='ArrowRight'?1:-1)+all.length)%all.length];
        else if(event.altKey&&/^[1-9]$/.test(event.key))target=all[Number(event.key)-1];
        if(target){event.preventDefault();event.stopPropagation();activate(target);}
    });
    function refresh(){
        tablist.querySelectorAll('[data-workspace]').forEach(tab=>tab.removeAttribute('aria-keyshortcuts'));
        tabs().forEach((tab,index)=>{tab.title=`${tab.textContent.trim()} - Ctrl+Alt+${index+1}`;if(index<9)tab.setAttribute('aria-keyshortcuts',`Control+Alt+${index+1}`);});
    }
    refresh();
    return {refresh,activate:workspace=>activate(tabs().find(tab=>tab.dataset.workspace===workspace))};
}
