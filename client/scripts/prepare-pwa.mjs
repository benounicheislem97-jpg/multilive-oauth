import fs from 'node:fs';
import path from 'node:path';

const output = path.resolve('dist-web');
const publicDirectory = path.resolve('public');
for (const name of fs.readdirSync(publicDirectory)) {
  fs.copyFileSync(path.join(publicDirectory, name), path.join(output, name));
}
const htmlFile = path.join(output, 'index.html');
let html = fs.readFileSync(htmlFile, 'utf8');
const head = `
  <meta name="theme-color" content="#BAF473">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="MultiLive">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icon-512.png">`;
const registration = `<script>if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}</script>`;
if (!html.includes('manifest.webmanifest')) html = html.replace('</head>', `${head}\n</head>`);
if (!html.includes("serviceWorker.register('/sw.js')")) html = html.replace('</body>', `${registration}\n</body>`);
fs.writeFileSync(htmlFile, html);

