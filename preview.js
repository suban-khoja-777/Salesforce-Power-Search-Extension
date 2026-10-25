const frame = document.querySelector('iframe');
let mode = 'popup';
const launch = document.getElementById('launch');
function updateViewport() { frame.contentWindow.postMessage({ type: 'POWER_SEARCH_VIEWPORT', mode, height: mode === 'popup' ? window.innerHeight * .9 : window.innerHeight }, location.origin); }
frame.addEventListener('load', () => { updateViewport(); frame.contentWindow.postMessage({ type: 'POWER_SEARCH_FOCUS' }, location.origin); });
window.addEventListener('resize', updateViewport);
window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
    if (event.data?.type === 'POWER_SEARCH_MODE' && ['popup','sidebar','fullpage'].includes(event.data.mode)) {
        mode = event.data.mode; document.body.dataset.mode = mode; frame.style.height = mode === 'popup' ? '90vh' : '100vh'; updateViewport();
    }
    if (event.data?.type === 'POWER_SEARCH_CLOSE') { frame.hidden = true; launch.hidden = false; launch.focus(); }
});
function open() { frame.hidden = false; launch.hidden = true; frame.contentWindow.focus(); }
launch.onclick = open;
document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.code === 'Space' && !event.shiftKey && !event.altKey && !event.metaKey) { event.preventDefault(); open(); }
});
