const { spawn, execSync } = require('child_process');
const path = require('path');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

const serverDir = path.resolve(__dirname, '..', 'server');
const clientDir = path.resolve(__dirname, '..', 'client');

console.log('[Dev] Starting Faculty Allotment System backend and frontend...');

const server = spawn(npmCmd, ['run', 'dev'], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: true,
});

const client = spawn(npmCmd, ['run', 'dev'], {
  cwd: clientDir,
  stdio: 'inherit',
  shell: true,
});

function killProcess(proc) {
  if (!proc || !proc.pid) return;
  if (isWindows) {
    try {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Process already closed
    }
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
}

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  console.log('\n[Dev] Shutting down backend and frontend...');
  killProcess(server);
  killProcess(client);
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
