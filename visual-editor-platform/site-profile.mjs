/** Per-page declaration, not an editor algorithm fork. */
export const lineVisualEditorConfig=Object.freeze({
 nodeMap: Object.freeze({
   'line.shell':'appShell',
   'line.conversation.title':'conversationTitle',
   'line.settings.title':'settingsTitle',
   'line.source.status':'sourceStatus'
 }),
 target:Object.freeze({
   appId:'line-style-viewer',routeId:'main',templateId:'conversation-shell',sourceRevision:'line-shell-v1'
 }),
 storageKey:'line-style-viewer:visual-editor-v2:v1'
});
