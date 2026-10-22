// Secure bridge between the renderer and main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('pcm', {
  platform: process.platform,
  lite: process.argv.includes('--bmp-lite'),
  caps: () => call('app:caps'),
  latest: () => call('app:latest'),
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
  v2: {
    smartScan: () => call('v2:smart:scan'),
    smartRun: () => call('v2:smart:run'),
    smartCancel: () => call('v2:smart:cancel'),
    maintList: () => call('v2:maint:list'),
    maintRun: (ids) => call('v2:maint:run', ids),
    privacyScan: () => call('v2:privacy:scan'),
    privacyClean: (ids) => call('v2:privacy:clean', ids),
    permList: () => call('v2:perm:list'),
    permRevoke: (appId, permId) => call('v2:perm:revoke', appId, permId),
    permReset: (appId) => call('v2:perm:reset', appId),
    leftovers: () => call('v2:leftovers:scan'),
    malwareScan: (kind) => call('v2:malware:scan', kind),
    malwareQuick: () => call('v2:malware:quick'),
    shred: (paths, opts) => call('v2:shred', paths, opts),
    lensScan: (root) => call('v2:lens:scan', root),
    lensCancel: () => call('v2:lens:cancel'),
    similarFind: (root) => call('v2:similar:find', root),
    similarCancel: () => call('v2:similar:cancel'),
    cloudDetect: () => call('v2:cloud:detect'),
    cloudAnalyze: (folder) => call('v2:cloud:analyze', folder),
    cloudFreeUp: (paths) => call('v2:cloud:freeUp', paths),
    cloudCancel: () => call('v2:cloud:cancel'),
    pick: (opts) => call('file:pick', opts),
    thumb: (p) => call('file:thumb', p),
    paths: () => call('app:paths'),
    // Local path of a file dropped into the shredder.
    filePath: (file) => webUtils.getPathForFile(file),
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
