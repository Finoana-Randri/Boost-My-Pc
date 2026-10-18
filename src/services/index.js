// Sélectionne l'implémentation des services selon le système d'exploitation.
const isLinux = process.platform === 'linux';
const dir = isLinux ? './linux/' : './';

module.exports = {
  platform: isLinux ? 'linux' : 'win32',
  system: require(dir + 'system'),
  cleaner: require(dir + 'cleaner'),
  apps: require(dir + 'apps'),
  protection: require(dir + 'protection'),
  storage: require('./storage'),
  tools: require('./tools'),
};
