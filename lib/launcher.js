import { salesforceContext } from './salesforce.js';

export async function launchPalette(browser, tab) {
    salesforceContext(tab?.url);
    if (!Number.isInteger(tab.id)) throw new Error('No active Salesforce tab was found.');
    const send = type => browser.tabs.sendMessage(tab.id, {type}, {frameId:0});
    let version;
    try {version = (await send('POWER_SEARCH_VERSION'))?.version;} catch { /* Tab predates extension installation or reload. */ }
    if (version !== '0.11.0') {
        try {await browser.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},files:['content.js']});}
        catch {throw new Error('Power Search could not start on this tab. Allow the extension access to this Salesforce site, reload the page, and try again.');}
    }
    let response;
    try {response = await send('TOGGLE_POWER_SEARCH_V080');} catch { /* Report failed handshake below. */ }
    if (!response?.ok) throw new Error('The search panel did not respond. Reload this Salesforce tab and try again.');
    return {ok:true};
}
