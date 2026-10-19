// Starts Vite on all interfaces and prints the LAN URL (+ QR code) for opening the app on a phone.
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import qr from 'qrcode-terminal';

const PORT = 5173;
const ips = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => n.address)
  // prefer typical home-LAN ranges over virtual adapters (WSL, Docker, VPN)
  .sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')));

const urls = ips.map((ip) => `http://${ip}:${PORT}/`);
console.log('\nOpen on your phone (same Wi-Fi):');
urls.forEach((u) => console.log('  ' + u));
if (urls[0]) qr.generate(urls[0], { small: true });
console.log('');

const vite = spawn('npx', ['vite', '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'], { stdio: 'inherit', shell: true });
vite.on('exit', (c) => process.exit(c ?? 0));
