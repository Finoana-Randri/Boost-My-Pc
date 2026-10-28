// Administrator rights on Windows. Three modes:
//   off     the actions that need them ask Windows (UAC) when they run;
//   prompt  Windows asks once at each launch;
//   task    the app starts elevated through a scheduled task created once with the user's consent.
//           Only for an installation in Program Files, which only administrators can modify:
//           anywhere else, such a task would let any program gain administrator rights.
const { app } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPS, psq } = require('./services/ps');

const isWindows = process.platform === 'win32';
const TASK_NAME = 'Boost My Pc (administrateur)';
const DENIED = 'Autorisation administrateur refusée.';

function isElevated() {
  if (!isWindows) return false;
  try {
    execFileSync('net', ['session'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isProtectedInstall() {
  if (!isWindows || !app.isPackaged) return false;
  const exe = process.execPath.toLowerCase();
  return [process.env.ProgramFiles, process.env.ProgramW6432]
    .filter(Boolean)
    .some((dir) => exe.startsWith(`${dir.toLowerCase()}\\`));
}

const defaultMode = () => (isProtectedInstall() ? 'task' : 'off');

function taskExists() {
  try {
    execFileSync('schtasks', ['/query', '/tn', TASK_NAME], { stdio: 'ignore', windowsHide: true, timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

const runTask = () => execFileSync('schtasks', ['/run', '/tn', TASK_NAME], { stdio: 'ignore', windowsHide: true, timeout: 10000 });

// The packaged exe, or Electron with the app folder during development.
function launchCommand() {
  return { exe: process.execPath, args: process.defaultApp ? [path.resolve(process.argv[1] || '.')] : [] };
}

function startElevatedCommand(extraArgs) {
  const { exe, args } = launchCommand();
  const argList = [...args.map((a) => `"${a}"`), '--no-elevate', ...extraArgs].map(psq).join(',');
  return `Start-Process -FilePath ${psq(exe)} -ArgumentList ${argList} -Verb RunAs`;
}

// Runs a PowerShell script with administrator rights: directly when the app has them, otherwise
// after one Windows prompt. A declined prompt is an error, never a silent success.
async function runElevated(script, timeout = 120000) {
  if (isElevated()) return runPS(script, { timeout });
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const args = `'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}'`;
  const command = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ${args} -ErrorAction Stop } catch { throw '${DENIED}' }
exit $p.ExitCode`;
  try {
    return await runPS(command, { timeout });
  } catch (err) {
    throw new Error(/annul|cancel|refusée/i.test(err.message) ? DENIED : err.message);
  }
}

async function setMode(mode) {
  if (!isWindows) throw new Error('Sous Linux, chaque action système demande votre mot de passe via polkit.');
  if (!['off', 'prompt', 'task'].includes(mode)) throw new Error('Mode inconnu.');
  if (mode === 'task') {
    if (!isProtectedInstall()) {
      throw new Error('Ce mode nécessite une installation « pour tous les utilisateurs » (dans Program Files). Réinstallez Boost My Pc en choisissant cette option.');
    }
    const { exe, args } = launchCommand();
    const user = `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;
    const argument = args.length ? ` -Argument ${psq(args.map((a) => `"${a}"`).join(' '))}` : '';
    await runElevated(`
      $a = New-ScheduledTaskAction -Execute ${psq(exe)}${argument}
      $p = New-ScheduledTaskPrincipal -UserId ${psq(user)} -LogonType Interactive -RunLevel Highest
      $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel
      Register-ScheduledTask -TaskName ${psq(TASK_NAME)} -Action $a -Principal $p -Settings $s -Force | Out-Null`);
    if (!taskExists()) throw new Error('La tâche planifiée n\'a pas pu être créée.');
  } else if (taskExists()) {
    await runElevated(`Unregister-ScheduledTask -TaskName ${psq(TASK_NAME)} -Confirm:$false`);
  }
  return mode;
}

// Starts an elevated copy of the app; the caller quits afterwards.
async function relaunchElevated(mode) {
  if (!isWindows) throw new Error('Sous Linux, chaque action système demande votre mot de passe.');
  // The elevated copy would otherwise hand over to this one and exit.
  app.releaseSingleInstanceLock();
  try {
    if (mode === 'task' && isProtectedInstall() && taskExists()) runTask();
    else await runPS(startElevatedCommand([]));
  } catch (err) {
    app.requestSingleInstanceLock();
    throw new Error(/annul|cancel/i.test(err.message) ? DENIED : err.message);
  }
}

// Flags that must survive the relaunch through elevation (started at logon, mini panel).
const KEPT_FLAGS = ['--hidden', '--mini'];
const flagsFile = () => path.join(app.getPath('userData'), 'launch-flags.json');

// At launch, starts an elevated copy if the user chose so. True when this process should exit.
function elevateAtLaunch(mode) {
  if (!isWindows || process.argv.includes('--no-elevate') || mode === 'off') return false;
  // Started hidden at logon: no Windows prompt then, only the silent task.
  if (mode === 'prompt' && process.argv.includes('--hidden')) return false;
  if (isElevated()) return false;
  try {
    fs.writeFileSync(flagsFile(), JSON.stringify({ flags: process.argv.filter((a) => KEPT_FLAGS.includes(a)), at: Date.now() }));
  } catch {}
  try {
    if (mode === 'task' && isProtectedInstall() && taskExists()) {
      runTask();
      return true;
    }
    // First launch after installation: create the task, with one Windows prompt.
    const createTask = mode === 'task' && isProtectedInstall();
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', startElevatedCommand(createTask ? ['--create-admin-task'] : [])],
      { stdio: 'ignore', windowsHide: true, timeout: 120000 });
    return true;
  } catch {
    // Declined or failed: carry on without administrator rights.
    return false;
  }
}

// Flags left by the non-elevated launcher (see elevateAtLaunch).
function inheritedFlags() {
  try {
    const saved = JSON.parse(fs.readFileSync(flagsFile(), 'utf8'));
    fs.unlinkSync(flagsFile());
    if (Date.now() - saved.at < 30000) return saved.flags.filter((f) => KEPT_FLAGS.includes(f));
  } catch {}
  return [];
}

function status(mode) {
  return { mode, protectedInstall: isProtectedInstall(), elevated: isElevated(), task: isWindows && taskExists() };
}

module.exports = { isElevated, defaultMode, runElevated, setMode, relaunchElevated, elevateAtLaunch, inheritedFlags, status };
