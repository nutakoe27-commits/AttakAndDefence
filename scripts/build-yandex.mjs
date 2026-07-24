// Сборка клиента под Яндекс Игры: собирает статический бандл в dist-yandex/
// с index.html в корне, относительными путями и адресом вашего WSS-бэкенда.
//
// Использование:
//   node scripts/build-yandex.mjs wss://ваш-домен/ws
//   AD_BACKEND=wss://ваш-домен/ws node scripts/build-yandex.mjs
//
// Затем заархивируйте СОДЕРЖИМОЕ dist-yandex (index.html должен быть в корне архива):
//   cd dist-yandex && zip -r ../attack-and-defence-yandex.zip . && cd ..
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist-yandex');

const backend = process.argv[2] || process.env.AD_BACKEND || '';
if (!backend) {
  console.error('❌ Укажите адрес WSS-бэкенда: node scripts/build-yandex.mjs wss://ваш-домен/ws');
  process.exit(1);
}
if (!/^wss:\/\//.test(backend)) {
  console.error('❌ Адрес бэкенда должен начинаться с wss:// (Яндекс Игры работают по HTTPS, ws:// заблокируется).');
  process.exit(1);
}

// Копируем только клиент: index.html, css, js. Админка и сервер в архив НЕ идут.
function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    if (filter && !filter(s, name)) continue;
    // Требование 1.22: без пробелов и кириллицы в именах файлов/папок.
    if (/[^\x20-\x7e]/.test(name) || /\s/.test(name)) {
      throw new Error(`Недопустимое имя файла (пробел/кириллица): ${name}`);
    }
    if (fs.statSync(s).isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// index.html — с подстановкой бэкенда.
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
html = html.replace(
  /window\.AD_BACKEND = window\.AD_BACKEND \|\| null;/,
  `window.AD_BACKEND = ${JSON.stringify(backend)};`
);
fs.writeFileSync(path.join(OUT, 'index.html'), html);

copyDir(path.join(SRC, 'css'), path.join(OUT, 'css'));
copyDir(path.join(SRC, 'js'), path.join(OUT, 'js'));

// Проверки соответствия требованиям.
const checks = [];
checks.push(['index.html в корне', fs.existsSync(path.join(OUT, 'index.html'))]);
checks.push(['бэкенд подставлен', html.includes(backend)]);
checks.push(['SDK Яндекса подключён', html.includes('yandex.ru/games/sdk/v2')]);
checks.push(['относительные пути (css)', html.includes('./css/style.css')]);
checks.push(['админка не попала в бандл', !fs.existsSync(path.join(OUT, 'admin'))]);

// Размер бандла (лимит Яндекса — 100 МБ).
let bytes = 0;
(function size(dir) { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); const st = fs.statSync(p); if (st.isDirectory()) size(p); else bytes += st.size; } })(OUT);
const mb = (bytes / 1048576).toFixed(2);
checks.push([`размер бандла ${mb} МБ < 100 МБ`, bytes < 100 * 1048576]);

console.log('\nСборка Яндекс-бандла:');
for (const [name, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
const allOk = checks.every(c => c[1]);
console.log(`\nБэкенд: ${backend}`);
console.log(`Каталог: ${OUT}`);
console.log('Заархивируйте содержимое каталога (index.html в корне) и загрузите в Консоль разработчика Яндекс Игр.');
console.log('  cd dist-yandex && zip -r ../attack-and-defence-yandex.zip . && cd ..');
process.exit(allOk ? 0 : 1);
