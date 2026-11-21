import { spawn } from 'node:child_process';

const server = spawn('node', ['server/index.js'], { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname });
const client = spawn('npx', ['vite'], { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname });

const stop = () => { server.kill(); client.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
