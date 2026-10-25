const title = document.getElementById('title');
const message = document.getElementById('message');
const retry = document.getElementById('retry');
async function launch() {
    retry.hidden = true;
    title.textContent = 'Opening search…';
    message.textContent = 'Connecting to the active Salesforce tab.';
    try {
        if (location.protocol !== 'chrome-extension:') throw new Error('This is a design preview. Load the extension in Chrome or Edge, then click its toolbar icon on Salesforce.');
        const response = await chrome.runtime.sendMessage({ type: 'OPEN_PALETTE' });
        if (!response?.ok) throw new Error(response?.error || 'The extension did not respond. Reload Power Search from the browser’s Extensions page, then retry.');
        title.textContent = 'Search opened';
        message.textContent = 'Power Search is ready on your Salesforce page.';
        window.close();
    } catch (error) {
        title.textContent = 'Couldn’t open Power Search';
        message.textContent = error.message || 'Reload the extension and Salesforce page, then try again.';
        retry.hidden = false;
    }
}
retry.onclick = launch;
launch();
