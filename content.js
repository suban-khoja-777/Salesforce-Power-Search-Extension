(() => {
    const version = '0.11.0';
    if (window !== window.top || globalThis.__powerSearchContent?.version === version) return;
    globalThis.__powerSearchContent?.dispose();
    const events = new AbortController();
    const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
    document.getElementById('power-search-extension-root')?.remove();
    const host = document.createElement('div');
    host.id = 'power-search-extension-root';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
        :host { all:initial; position:fixed!important; inset:0!important; z-index:2147483647!important; display:none!important; }
        :host([data-open]) { display:block!important; }
        .backdrop { position:absolute; inset:0; background:rgba(25,29,43,.28); backdrop-filter:blur(7px); }
        iframe { position:absolute; top:5vh; left:5vw; width:90vw!important; height:90vh!important; max-width:none!important; max-height:90vh!important; border:0; border-radius:18px; box-shadow:0 28px 110px #151b3d44; background:transparent; color-scheme:light; }
        :host([data-mode=sidebar]) { pointer-events:none; }
        :host([data-mode=sidebar]) .backdrop,:host([data-mode=fullpage]) .backdrop { display:none; }
        :host([data-mode=sidebar]) iframe { pointer-events:auto; top:0; right:0; left:auto; transform:none; width:min(480px,100vw)!important; height:100vh!important; max-height:100vh!important; border-radius:18px 0 0 18px; }
        :host([data-mode=fullpage]) iframe { inset:0; left:0; transform:none; width:100vw!important; height:100vh!important; max-height:100vh!important; border-radius:0; }
        @media(prefers-reduced-transparency:reduce) { .backdrop { backdrop-filter:none; background:rgba(25,29,43,.5); } }
    `;
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    shadow.append(style, backdrop);
    let frame, previousFocus, mode = 'popup', frameReady = false;
    const validMode = value => ['popup','sidebar','fullpage'].includes(value) ? value : 'popup';
    function setMode(value) {
        mode = validMode(value); host.dataset.mode = mode;
        updateViewport();
    }
    function close() {
        frameReady = false;
        host.removeAttribute('data-open');
        frame?.remove(); frame = null;
        if (previousFocus?.isConnected) previousFocus.focus();
    }
    function open() {
        if (host.hasAttribute('data-open')) return;
        previousFocus = document.activeElement;
        frameReady = false;
        frame = document.createElement('iframe');
        frame.src = chrome.runtime.getURL(`app/palette.html?parent=${encodeURIComponent(location.origin)}`);
        frame.title = 'Power Search for Salesforce';
        frame.setAttribute('allow', '');
        shadow.append(frame);
        host.setAttribute('data-open', '');
        setMode(mode);
        const openedFrame = frame;
        chrome.storage.local.get('displayMode').then(value => { if (frame === openedFrame) setMode(value.displayMode); }).catch(() => {});
    }
    function updateViewport() {
        if (frame) frame.style.height = `${window.innerHeight * (mode === 'popup' ? .9 : 1)}px`;
        if (frameReady && frame) frame.contentWindow.postMessage({ type: 'POWER_SEARCH_VIEWPORT', mode, height: mode === 'popup' ? window.innerHeight * .9 : window.innerHeight }, extensionOrigin);
    }
    window.addEventListener('resize', updateViewport, {signal:events.signal});
    function toggle() { host.hasAttribute('data-open') ? close() : open(); }
    backdrop.addEventListener('click', close);
    const onMessage = (message, _sender, sendResponse) => {
        if (message.type === 'POWER_SEARCH_VERSION') {sendResponse({ok:true,version});return false;}
        if (message.type === 'TOGGLE_POWER_SEARCH_V080') {
            toggle();
            sendResponse({ ok: true });
        }
        return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    document.addEventListener('keydown', (event) => {
        if (!chrome.runtime?.id) return;
        if (event.ctrlKey && event.code === 'Space' && !event.shiftKey && !event.altKey && !event.metaKey) {
            event.preventDefault(); event.stopPropagation(); toggle();
        }
        if (event.key === 'Escape' && host.hasAttribute('data-open')) close();
    }, {capture:true,signal:events.signal});
    window.addEventListener('message', (event) => {
        if (event.source !== frame?.contentWindow || event.origin !== extensionOrigin) return;
        if (!frame) return;
        if (event.data?.type === 'POWER_SEARCH_READY') {
            const firstReady = !frameReady;
            frameReady = true;
            updateViewport();
            if (firstReady) {frame.focus();frame.contentWindow.postMessage({type:'POWER_SEARCH_FOCUS'},extensionOrigin);}
        }
        if (event.data?.type === 'POWER_SEARCH_CLOSE') close();
        if (event.data?.type === 'POWER_SEARCH_MODE') setMode(event.data.mode);

    }, {signal:events.signal});
    document.documentElement.append(host);
    globalThis.__powerSearchContent = {version,dispose(){events.abort();chrome.runtime.onMessage.removeListener(onMessage);close();host.remove();}};
})();
