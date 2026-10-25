# Allowed search categories

Only these 18 categories are enabled, plus the All tab. Objects include names and labels only; fields are excluded.

| Tab | Prefix | Source |
| --- | --- | --- |
| Apex Class | apex: | ApexClass |
| Apex Trigger | trigger: | ApexTrigger |
| LWC | lwc: | LightningComponentBundle |
| Aura Components | aura: | AuraDefinitionBundle |
| VisualForce Page | vfpage: | ApexPage |
| Apex Components | vfcomponent: | ApexComponent |
| Flow | flow: | Flow |
| Profiles | profile: | Profile |
| Permission Set | permissionset: | PermissionSet |
| Permission Set Group | permissiongroup: | PermissionSetGroup |
| Apps | app: | CustomApplication |
| Queue | queue: | Salesforce REST |
| Role | role: | Salesforce REST |
| Group | group: | Salesforce REST |
| Global Value Set | valueset: | GlobalValueSet |
| Objects | object: | CustomObject |
| Recently Viewed Records | recentrecord: | Salesforce REST |
| Users | user: | Salesforce REST |

All is the default; recently opened components appear first there with actual types and no duplicate results. There is no separate component-history tab. Supported item destinations open in new tabs; unavailable destinations show metadata details. See [README](README.md) for permissions and API limits.

## Navigation audit (0.9.1)

| Categories | Destination |
| --- | --- |
| Apex Class, Apex Trigger | Individual Setup item by ID |
| LWC, Aura Components | LightningComponentBundles detail by bundle ID |
| VisualForce Page, Apex Components | ApexPages / ApexComponent detail by ID |
| Profiles | EnhancedProfiles detail by ID |
| Permission Set / Group | PermSets / PermSetGroups detail by ID |
| Queue | Queues with /p/own/Queue/d?id=ID |
| Group | PublicGroups with /setup/own/groupdetail.jsp?id=ID |
| Role | Roles detail by ID |
| Flow | Flow Builder for a 301 version ID |
| Objects | Object Manager details by API name |
| Users | ManageUsers detail by ID |
| Recently Viewed Records | Record detail by object name and ID |
| Apps, Global Value Set | In-extension metadata details; direct Setup routes not yet verified |

Missing or incompatible IDs show metadata details rather than a generic list. Managed entries remain excluded. Existing cached entries use the updated adapter immediately. Setup route shapes were cross-checked against the implementation author's published [Org Check navigation reference](https://www.linkedin.com/posts/orgchecksfdc_did-you-know-that-when-we-give-you-the-ability-activity-7260699596413104128-BRkR). These are Setup UI URLs, not a stable API contract; tests validate construction and isolation, not live Salesforce rendering.
