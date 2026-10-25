# Power Search extension · 0.11.0

The extension is self-contained in this folder. The original Salesforce LWC/Apex project is preserved.

## Coding workspace

Open **Coding → Open Coding in a new tab** from Power Search on Salesforce. Keep the originating Salesforce tab open and signed in. The dedicated extension tab supports native local-folder access and is bound to that org and browser cookie store. It cannot accept an arbitrary org URL. Managed/namespaced code is excluded from the explorer and project downloads.

- Explorer groups: **Classes, Triggers, LWC**. Opening a component retrieves its complete Metadata API source, including XML companion files and all supported LWC resources. Multiple components and files can be open together. Closing a component closes its files and asks before discarding edits.
- Locally bundled **Monaco** editor: syntax colors, line numbers, folding, bracket matching, undo/redo, find/replace, word wrap, dark/light theme and dirty indicators. JavaScript/HTML/CSS use Monaco language support. Apex has keyword, class-name and snippet suggestions; it does not include Salesforce's Java-based language server or full semantic Apex IntelliSense.
- **Ctrl/Cmd+S** deploys the active component, including changes in its other files. **Ctrl/Cmd+Shift+S** saves changed components sequentially, stopping on the first failure; it is not one atomic cross-component deployment. **Ctrl/Cmd+P** focuses explorer search. **Ctrl+Space** requests suggestions inside the editor. **Ctrl/Cmd+F** opens find/replace.
- Before deployment, source is retrieved again and compared with the original snapshot. Changed Salesforce source blocks the save: download your edits, reload, and merge. This is optimistic detection, not a server-side source lock; another change during the subsequent deployment remains possible.
- Metadata deployments use `rollbackOnError=true`, a complete component bundle and `RunLocalTests`. Compilation/test errors appear in Output & Problems with clickable source locations. Failed deployments preserve edits for correction. Polling uses persisted job IDs across worker suspension. After a connection failure, use **Check pending operation**. If the outcome is unknown, check **Setup → Deployment Status** before retrying. **Stop checking** does not cancel a deployment.
- **Download whole project ZIP** retrieves all eligible Classes, Triggers and LWC in the org, including `package.xml`. This is Metadata API format, not a complete Salesforce DX project or a backup of every metadata type. **Download edits** preserves the active component's unsaved buffers in a ZIP.
- For local sync, choose a project folder, **Save whole project to folder**, then enable **Sync editor saves to folder**. A save deploys to Salesforce first and writes local files only after success. Each side reports its outcome; a local failure cannot roll back an already successful Salesforce deployment. Existing different local files and external edits are blocked. Partial filesystem writes are reported with a count. The org marker prevents using one folder for different orgs. Re-select and initialize the folder after reopening the editor. File access requires desktop Chrome/Edge and a user-granted folder permission.
- Sync applies to saves in this editor. There is no background watcher for changes from desktop VS Code, Git integration, terminal, debugger, component creation/deletion/rename, or automated two-way merge. Unsaved buffers live in the tab; closing/reloading warns but does not persist them. Pending deployment status can be resumed after reload; re-retrieve source to update local files afterward.

Source retrieval/export is bounded to **4 MB uncompressed / 10,000 files** per operation. Larger projects must be retrieved through Salesforce CLI. Metadata permissions, compile rules, Apex test failures and production coverage requirements are enforced by Salesforce. Source may temporarily reside in extension session storage while a save waits for its preflight check; job/snapshot records expire after eight hours and are cleaned on the next Coding catalog load. Session tokens remain exclusively in worker memory. No editor code is loaded from a CDN.

`npm run build:vendor` builds the bundled editor, language workers, XML parser and ZIP utilities. Restart the extension after a rebuild. `http://127.0.0.1:4175/app/coding.html` is a sample-only editor preview, including simulated saves; it does not prove a live Salesforce deployment or actual native folder permissions. References: [Monaco integration](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md), [Salesforce Metadata API guide](https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_meta.pdf), [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

## Install and upgrade

Load this folder unpacked through Chrome/Edge extensions in Developer mode. For an existing installation, click Reload, then open the extension from the toolbar. The launcher checks the host version and replaces stale hosts, including the previous compact popup. Refresh the Salesforce tab once after upgrading to remove legacy page keyboard listeners. Click the supplied cloud-search icon or press **Ctrl+Space** to open Spotlight search. The macOS shortcut uses the Control key too.

Chrome may retain an existing shortcut after an upgrade, or an OS/input-method shortcut may take priority. Set Toggle Power Search to Ctrl+Space at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts` if needed.

## Categories and recent history

Tabs cover exactly the 18 categories in [METADATA-COVERAGE.md](METADATA-COVERAGE.md), plus All. Tabs wrap to keep the categories visible, with scrolling on smaller screens. Fields and other excluded metadata are not indexed by metadata search. Query Records loads field descriptions for its editor. Existing field caches are excluded from the new catalog.

**All is the first and default tab.** Recently opened components appear first there with their actual types, merged with the catalog without duplicate rows. There is no separate Recently Viewed Components tab. Up to 50 items opened through Power Search are remembered. History is isolated by org, cookie store and Salesforce session and lasts for the browser session. It does not track arbitrary Setup navigation outside the extension. A first session starts with an explanatory empty state.

**Recently Viewed Records** retrieves up to 100 records from Salesforce RecentlyViewed, ordered by LastViewedDate. Only record names, IDs and object types are used. A record can appear only if Salesforce makes it available to the signed-in user. This category refreshes when selected; it does not search business record contents.

Apex, triggers and objects load first; selected metadata categories load with up to three concurrent workers. Metadata coverage shows errors and item counts. Index all types retries categories; Pause stops new requests after current requests finish. All searches indexed categories and recent component history together, without duplicate rows. Managed package components are always excluded from every category, search, cached results and recent history. Namespaced components and records on namespaced objects are excluded; there is no toggle to show them. Prefixes such as `apex:`, `lwc:`, `flow:` and `object:` are supported.

## Display options

Use the View selector to choose **Popup**, **Sidebar**, or **Full page**. Popup is centered over Salesforce at 90% of the browser viewport width and height; Sidebar docks to the right and lets you continue interacting with Salesforce beside it; Full page fills the current Salesforce viewport. The compact interface reduces header spacing and row heights and combines query actions to leave more room for results. These are layouts inside the current org tab, not an independent extension tab or Chrome's native side panel. The choice takes effect immediately and is saved in chrome.storage.local across browser sessions. Metadata and recent history remain in session storage.

## Users search

The Users tab searches visible Salesforce users by name or username, including inactive users with a status label. It retrieves only ID, name, username and active status through read-only REST queries. Opening a user opens that user's Setup page in a new tab. Your Salesforce user visibility and permissions apply.

## Navigation and keyboard

Click or Enter always opens a new tab, preserving the current Salesforce page. Up/Down selects results. Escape or Ctrl+Space closes the palette. Ctrl+Left/Right cycles through workspace tabs, and Ctrl+Alt+1–9 selects a tab by position (1 = Search, 2 = Query). These shortcuts work from the query editor and extend to future tabs automatically. A pending deletion review must be dismissed before switching with a shortcut. Arrow keys, Home and End navigate the focused tab bar. Tab stays within the palette in Popup/Full page; Sidebar permits normal focus navigation. Sizing and search focus messages wait for the extension iframe’s origin-validated readiness signal; no cross-origin HTML autofocus is used.

Items with supported IDs open their individual Setup detail pages. Unsupported destinations show metadata details with a copyable API name; they no longer silently redirect to a category list. Apps and Global Value Sets currently use this details fallback. See the navigation audit in METADATA-COVERAGE.md. Metadata search is read-only. Query Records supports explicitly confirmed record deletion.

## Query Records

Use the highlighted **Search** and **Query** tabs at the top to switch workspaces while preserving your editor and results. Query focuses the main editor. Type an object API name or label there to see object badges. Click a badge or select with Up/Down and Enter/Tab to generate `SELECT Id FROM Object`, then add fields and conditions. Root-object fields appear as clickable badges under the editor as you type; Up/Down and Enter/Tab accept suggestions. **View all fields** opens a searchable badge list; clicking a field adds it to the outer SELECT list without duplicating an existing field. In WHERE conditions, completing a field shows value badges: all picklist values returned by Describe, true/false for boolean fields, and null for other types. Click a badge or use Up/Down and Enter/Tab; picklist API values are quoted and escaped automatically. Choosing a value immediately after a field adds `=` (or `INCLUDES (...)` for a multi-select picklist). Suggestions also work after comparison operators and inside IN/INCLUDES/EXCLUDES lists. Type part of a value or label to filter the badges. Inactive values returned by Salesforce remain available for querying historical records and are identified in the badge tooltip. These are object-level values, not record-type-specific choices. Related-object and subquery field value suggestions are not included. [Salesforce Describe field and picklist reference](https://developer.salesforce.com/docs/platform/api/guide/sforce-api-calls-describesobjects-describesobjectresult.html).

Ctrl/Cmd+Enter runs SOQL. Salesforce validates query syntax, access and field permissions. Managed package objects and fields are excluded. Relationship paths and subqueries can be typed manually; nested-field autocomplete is not included.

Results show 50 loaded rows per table page. Use **Load more** or **Load all** to fetch additional Salesforce pages (Load all stops after 50 requests per click; workspace maximum 10,000 rows). Search filters loaded results across columns. Each cell has Copy, and each column has Copy column for filtered loaded values. Include the root record Id to enable record links and checkboxes. Links open in a new Salesforce tab. Relationship values are flattened into columns; child-query results remain JSON values.

**Export CSV** offers filtered, all loaded, or selected rows. Exports include column headers, UTF-8 BOM and quoted/escaped values; formula-like strings receive an apostrophe prefix for spreadsheet safety. Unloaded Salesforce rows are not included. Selection persists across result filters and table pages, so the selection count can exceed the visible count.

**Delete selected** supports up to 200 records per operation. A review shows the org, object and exact IDs and requires typing DELETE. Confirmation expires after 60 seconds. The worker only accepts IDs loaded by that query in that tab and Salesforce session. Salesforce object permissions, deletion rules, automation and related-record effects apply. The operation permits partial success: failed rows remain with error codes. Run the query again after deletion or an uncertain outcome to verify current data. No destructive request is automatically retried.

Object descriptions and query-session authorization expire after 15 minutes in background memory. Record values are not persisted in extension storage. Query text is stored locally for history and saved queries as described below. Worker restarts or Salesforce session changes require rerunning the query. Existing org API-access and cookie/session restrictions apply. This feature uses the [Salesforce Query API](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-query.html), [sObject Describe](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-sobject-describe.html), and [sObject Collections Delete](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-sobjects-collections-delete.html).

The local preview has sample Account/Contact data and accepts simple SELECT field lists. Its deletions affect sample memory only and reset on page reload. The installed extension executes SOQL against the connected org.

## Multiple query tabs, history and saved queries

Use **+ Query** for an independent editor and results tab (up to eight open tabs). Each tab retains its object, SOQL, results, filters and selection while the popup stays open, including while other tabs run. Close a tab with ×; **Reopen closed** restores the most recently closed tab. Closing the popup ends these working tabs; use Save query to keep a draft for a future session.

**History** stores the latest 50 distinct successfully executed queries. **Save query** stores a named query without running it; opening a saved query and saving it again updates that saved entry. Up to 100 saved queries are supported. Both lists are searchable. Opening an item creates a new tab without executing it. Remove saved entries or clear history through their library controls.

Query text (including WHERE literals), object names, names and timestamps are stored in chrome.storage.local for the current org API domain and browser cookie store. They persist across extension/browser restarts and Salesforce login-session changes; they are shared by Salesforce users using that same org and browser cookie store. Results, selections, session tokens and credentials are not stored in this library. Browser profiles and org domains have separate libraries. Managed-package queries are excluded. The sample preview uses a separate local sample library.

## API, authentication and caching

Enhanced-domain Salesforce Lightning and Setup pages are supported, including `.sandbox` and `.develop`. The worker derives the org from the validated tab URL and reads only that org's API-host session cookie in that tab's cookie store. Tokens stay in worker memory, travel only to that Salesforce org over HTTPS and never enter the UI or extension storage.

Apex, triggers, objects, queues, public groups, roles, users and recent records use read-only REST queries/catalogs. The other categories use Metadata API listMetadata at API version 65.0. No discovery can add types outside the allowlist. listMetadata has a 1,000-item query limit; the UI warns if reached. REST metadata pagination has a 50-page safety bound.

Org API access, metadata visibility, folder/session/IP policies and user permissions apply. Failures are displayed and partial metadata results are not cached as complete. OAuth-only orgs, partitioned session cookies, Classic instance domains, custom Experience Cloud/government domains, Firefox and mobile are not supported yet.

Metadata caches expire after 15 minutes in chrome.storage.session and are scoped by origin, cookie store and a SHA-256 session fingerprint. Recent records have a short cache and reload on selection. Refresh reloads the allowed index and preserves component history. Quota failures do not block live navigation.

## Checks and sample preview

With Node.js 22+, run from this directory:

```powershell
npm test
npm run check
npm run preview
```

The localhost preview uses sample metadata and makes no Salesforce calls. Tests mock browser/Salesforce APIs. Installed extension behavior, permissions, shortcuts and Setup destinations still need live-org validation.

DOM tests cover All/history deduplication, Users search, layout preference persistence, query editing, suggestions, filtering, CSV scope, selection and partial-delete rendering. Worker/service tests cover query session ownership, cursor validation, row limits, confirmation, expiry and one-use deletion tickets. They do not substitute for live browser verification.

The XML parser is bundled in vendor; no installation is needed to load the extension. Use `npm ci` and `npm run build:vendor` only to rebuild that dependency. The user-supplied logo is stored unchanged in assets/logo.png and used for the palette, launcher, preview and browser icons.

References: [Chrome commands](https://developer.chrome.com/docs/extensions/reference/api/commands), [Salesforce recently viewed items](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-recent-items.html), [Salesforce Metadata API](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_intro.htm).

## 0.9.1 performance and navigation update

Queryable objects and object descriptions are cached in worker memory for 15 minutes per Salesforce session. Concurrent tabs share in-flight requests; failures are retryable and results are never cached. Warm runs need only the query request. Query pages request up to 2,000 rows instead of 200 (Salesforce may return fewer). Load all accumulates pages without rebuilding the result table for every page; columns are discovered only from new rows. All-fields buttons are created only when requested, and editor typing no longer rebuilds the tab bar.

History and Saved are toggle buttons: click the active button again to close, or the other button to switch. Filtering the library uses the loaded data without repeated storage/worker requests. Saved-query removal and Clear history remain available.

Validation uses mocked Salesforce responses and local DOM tests; live-org timing and Setup navigation require checking in the installed extension. API batch behavior: https://developer.salesforce.com/docs/platform/api-rest/guide/headers-queryoptions.html

## 0.10.0: audit details, debug settings and current-record editing

Search rows show Created Date, Created By, Last Modified Date and Last Modified By. Apex, triggers and users include audit relationships in REST queries. SOAP FileProperties supplies audit values for other metadata, including a best-effort enrichment of custom objects, queues, groups and roles. Recent records fetch audit values in batches per object, with at most three concurrent requests. Unsupported standard-object metadata and inaccessible audit data show Unavailable. Object audit enrichment runs after initial search results render, so it does not delay the core index. Old metadata caches are refreshed automatically; namespaced components remain excluded.

Settings is a top-level workspace. Configure eight debug categories and a duration of 15, 30 (default), 60 or 120 minutes. Save settings persists preferences per org and browser cookie store. Enable debug logs for me is available in Search and Settings; it derives the current user from the authenticated Salesforce session, reuses a level with the same configuration, and creates or updates that user's active USER_DEBUG trace flag. Debug Logs opens in a new tab only after activation succeeds. Required Salesforce permissions and log storage limits still apply. No background renewal occurs; Salesforce expires the trace flag at the selected time.

The Record workspace is visible on standard Lightning record URLs (/lightning/r/ObjectApiName/RecordId/view or edit). While the extension is open, host-tab context is checked every two seconds without API requests. Navigating to another record clears the old snapshot and drafts; list/Setup pages hide the tab. Classic, custom routed pages, and console subtabs that do not expose their current record in the browser URL are not detected in this release. The local preview deliberately supplies a sample Account for demonstration.

Record loads all API-readable non-managed fields with their label, API name and value. Search matches all three. Edit one or several fields, then Save changes submits only changed fields in one PATCH. Read-only fields and unsupported compound/binary types are displayed without editors. Picklists and booleans use selectors; references accept IDs, multi-select picklists accept semicolon-separated API values, and date-times accept ISO strings. Clearing a nullable field sends null. Salesforce enforces field permissions, record access and validation rules.

Updates bind to the current org/session, host tab and record, with a 15-minute snapshot and If-Unmodified-Since concurrency check. No automatic write retries. After a failed or uncertain save, drafts remain visible for copying, but reload is required before retrying. Discard edits restores the loaded values; Reload fields fetches a new snapshot. Record values and drafts stay in memory and are lost when the palette closes. Refresh the Salesforce page after saving to update its existing page UI.

Verification: unit/integration tests use mocked Salesforce APIs; local browser preview uses sample data and performs no real record or debug-log changes. Live-org validation remains necessary.

API references: [record fields and field-level access](https://developer.salesforce.com/docs/platform/api-rest/guide/dome-get-field-values.html), [conditional updates](https://developer.salesforce.com/docs/platform/api-rest/guide/intro-rest-conditional-requests.html), [TraceFlag](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_traceflag.htm), [DebugLevel](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_debuglevel.htm).
