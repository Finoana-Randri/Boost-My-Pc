// Disk Map scan process, started by spacelens.js with utilityProcess.fork().
const { scanHere, cancel } = require('./spacelens');

process.parentPort.on('message', async ({ data }) => {
  if (data.type === 'cancel') return cancel();
  if (data.type !== 'scan') return;
  try {
    const res = await scanHere(data.root, (p) => process.parentPort.postMessage({ type: 'progress', data: p }));
    process.parentPort.postMessage({ type: 'done', data: res });
  } catch (e) {
    process.parentPort.postMessage({ type: 'error', error: e.message });
  }
});
