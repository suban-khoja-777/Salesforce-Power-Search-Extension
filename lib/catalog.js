export const COMMON_TYPES = [
 ['apex','Apex Class','ApexClass','Apex class','ApexClasses'],
 ['trigger','Apex Trigger','ApexTrigger','Apex trigger','ApexTriggers'],
 ['lwc','LWC','LightningComponentBundle','LWC','LightningComponentBundles'],
 ['aura','Aura Components','AuraDefinitionBundle','Aura component','LightningComponentBundles'],
 ['vfpage','VisualForce Page','ApexPage','Visualforce page','ApexPages'],
 ['vfcomponent','Apex Components','ApexComponent','Apex component','ApexComponents'],
 ['flow','Flow','Flow','Flow','Flows'],
 ['profile','Profiles','Profile','Profile','Profiles'],
 ['permissionset','Permission Set','PermissionSet','Permission set','PermSets'],
 ['permissiongroup','Permission Set Group','PermissionSetGroup','Permission set group','PermSetGroups'],
 ['app','Apps','CustomApplication','App','NavigationMenus'],
 ['queue','Queue','Queue','Queue','Queues'],
 ['role','Role','Role','Role','Roles'],
 ['group','Group','Group','Group','PublicGroups'],
 ['valueset','Global Value Set','GlobalValueSet','Global value set','Picklists'],
 ['object','Objects','CustomObject','Object','ObjectManager'],
 ['recentrecord','Recently Viewed Records',null,'Record',null],
 ['user','Users','User','User','ManageUsers']
].map(([key,label,metadataType,singular,section]) => ({key,label,metadataType,singular,section,inFolder:false}));
export const CORE_TYPES = ['apex','trigger','object'];
export const RECENT_TYPES = ['recentrecord','recentcomponent'];
export const HISTORY_TYPE = {key:'recentcomponent', label:'Recent items', singular:'Component', metadataType:null, section:null};
export function descriptorFor(key) { return COMMON_TYPES.find(type => type.key === key) || (key === 'recentcomponent' ? HISTORY_TYPE : undefined); }
export function categoryForMetadata(xmlName) { return COMMON_TYPES.find(type => type.metadataType === xmlName); }
// Discovery never expands the user's explicit allowlist.
export function mergeCatalog() { return COMMON_TYPES.map(type => ({...type})); }
