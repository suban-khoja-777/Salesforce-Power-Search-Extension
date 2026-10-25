# Active development scope

The user has switched Power Search development to this browser extension. Keep new extension work self-contained in this directory. Preserve the parent LWC/Apex project unless the user explicitly requests changes to it.

Use Manifest V3 for Chrome/Edge. Keep session tokens in the background worker; never expose them to content scripts or UI or persist them. Derive the Salesforce org from a validated browser-tab URL, not from arbitrary message input. Render metadata labels with textContent.

Run `npm test` and `npm run check` from this directory for functional changes. Sample previews do not substitute for live extension/Salesforce validation; report which checks were actually run.
