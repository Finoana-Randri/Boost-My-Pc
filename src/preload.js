// Pont sécurisé entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('pcm', {
  platform: process.platform,
  caps: () => call('app:caps'),
  system: {
    stats: () => call('system:stats'),
    disks: () => call('system:disks'),
    info: () => call('system:info'),
    boost: () => call('system:boost'),
    isAdmin: () => call('system:isAdmin'),
    relaunchAdmin: () => call('system:relaunchAdmin'),
  },
  clean: {
    scan: (scene) => call('clean:scan', scene),
    run: (ids) => call('clean:run', ids),
  },
  storage: {
    large: (opts) => call('storage:large', opts),
    downloads: () => call('storage:downloads'),
    duplicates: (opts) => call('storage:duplicates', opts),
    cancel: () => call('storage:cancel'),
    pickFolder: () => call('storage:pickFolder'),
  },
  apps: {
    processes: () => call('apps:processes'),
    kill: (ids, name, opts) => call('apps:kill', ids, name, opts),
    startup: () => call('apps:startup'),
    setStartup: (item, enabled) => call('apps:setStartup', item, enabled),
    installed: () => call('apps:installed'),
    uninstall: (app) => call('apps:uninstall', app),
  },
  protect: {
    status: () => call('protect:status'),
    quickScan: () => call('protect:quickScan'),
    updateSignatures: () => call('protect:updateSignatures'),
    updates: () => call('protect:updates'),
    installUpdates: () => call('protect:installUpdates'),
    action: (id) => call('protect:action', id),
  },
  net: {
    diagnose: () => call('net:diagnose'),
    fix: (id) => call('net:fix', id),
  },
  file: {
    trash: (paths) => call('file:trash', paths),
    reveal: (p) => call('file:reveal', p),
    open: (p) => call('file:open', p),
    icon: (p) => call('file:icon', p),
  },
  tool: { launch: (id) => call('tool:launch', id) },
  prefs: {
    get: () => call('prefs:get'),
    set: (p) => call('prefs:set', p),
  },
  ui: {
    openMain: (page) => call('ui:openMain', page),
    hideMini: () => call('ui:hideMini'),
    summary: (force) => call('mini:summary', force),
    onShown: (cb) => ipcRenderer.on('mini:shown', () => cb()),
    onAction: (cb) => ipcRenderer.on('mini:action', (_e, a) => cb(a)),
  },
  onProgress: (cb) => ipcRenderer.on('progress', (_e, d) => cb(d)),
  onAction: (cb) => ipcRenderer.on('action', (_e, a) => cb(a)),
});
