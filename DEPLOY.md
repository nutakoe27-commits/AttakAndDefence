# Деплой Attack & Defence на собственный сервер

Инструкция рассчитана на чистый VPS/выделенный сервер с Ubuntu 22.04/24.04 (для Debian всё то же самое).
Пока домена нет — играем по IP; раздел «Будущий домен» ниже подключается за 10 минут, когда домен появится.

---

## 1. Подготовка сервера

```bash
# под root или через sudo
apt update && apt upgrade -y
apt install -y curl git nginx

# Node.js 20 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # должно быть >= 18
```

Создаём отдельного пользователя (не запускаем игру под root):

```bash
adduser --system --group --home /opt/attackdefence gameadmin
```

## 2. Код и зависимости

```bash
cd /opt/attackdefence
git clone https://github.com/nutakoe27-commits/AttakAndDefence.git app
cd app
npm ci --omit=dev
chown -R gameadmin:gameadmin /opt/attackdefence
```

Быстрая проверка: `npm test` (займёт ~1 минуту) — все тесты должны пройти.

## 3. Конфигурация

Секреты храним в env-файле:

```bash
cat > /opt/attackdefence/app.env << 'EOF'
PORT=3000
HOST=127.0.0.1
# ⚠ ОБЯЗАТЕЛЬНО придумайте свой длинный пароль админки:
ADMIN_PASSWORD=ЗАМЕНИТЕ_НА_ДЛИННЫЙ_СЛУЧАЙНЫЙ_ПАРОЛЬ
# Заглушка под будущий домен — пока указываем IP сервера:
PUBLIC_ORIGIN=http://ВАШ_IP
EOF
chmod 600 /opt/attackdefence/app.env
chown gameadmin:gameadmin /opt/attackdefence/app.env
```

`HOST=127.0.0.1` — приложение слушает только localhost, наружу его публикует nginx.

## 4. systemd — автозапуск и рестарты

```bash
cat > /etc/systemd/system/attackdefence.service << 'EOF'
[Unit]
Description=Attack & Defence game server
After=network.target

[Service]
Type=simple
User=gameadmin
Group=gameadmin
WorkingDirectory=/opt/attackdefence/app
EnvironmentFile=/opt/attackdefence/app.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
# правки баланса из админки пишутся в server/config/ — каталог должен быть записываемым
ReadWritePaths=/opt/attackdefence/app/server/config

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now attackdefence
systemctl status attackdefence      # active (running)
journalctl -u attackdefence -f      # живые логи
```

## 5. nginx — прокси с WebSocket

```bash
cat > /etc/nginx/sites-available/attackdefence << 'EOF'
# ======================================================================
# Attack & Defence
# Сейчас работаем по IP (server_name _). Когда купите домен —
# см. раздел «Будущий домен»: замените server_name и включите HTTPS.
# ======================================================================
server {
    listen 80 default_server;
    server_name _;   # ЗАГЛУШКА: замените на game.example.com при покупке домена

    # Игровой WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;   # матчи длинные — не рвём сокет
        proxy_send_timeout 3600s;
    }

    # Статика и admin API
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
EOF

ln -sf /etc/nginx/sites-available/attackdefence /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 6. Файрвол

```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp    # пригодится для HTTPS в будущем
ufw enable
```

Порт 3000 наружу **не** открываем — к приложению ходит только nginx.

## 7. Проверка

- `http://ВАШ_IP/` — игра открывается, статус «сервер онлайн» зелёный.
- Нажмите «В бой» — через 20 секунд должен подключиться бот.
- `http://ВАШ_IP/admin` — вход по паролю из `app.env`, на дашборде виден ваш матч.
- Откройте игру с двух устройств и нажмите «В бой» на обоих — должен собраться PvP-матч.

## 8. Обновление версии

> `$APP` ниже — каталог приложения. Если ставили по инструкции — это
> `/opt/attackdefence/app` (команды через `sudo -u gameadmin`). Если запускаете
> под root из `/root/app` — это `/root/app` (без `sudo -u gameadmin`).

### 8.1. Обычное обновление (рутинное)

```bash
cd $APP
git pull
npm ci --omit=dev            # зависимостей почти нет (только ws), пройдёт быстро
systemctl restart attackdefence
systemctl status attackdefence --no-pager     # active (running)
```

Правки баланса из админки (`server/config/balance.custom.json`) и база статистики
(`server/data/stats.db`) — в `.gitignore`, `git pull` их не трогает.

### 8.2. Первое обновление на новую версию — три доп. шага

Это обновление принесло **новую схему баланса** (переименованы поля экономики,
убрана баррикада, добавлены прогрессивное усиление юнитов и др.), **статистику**,
**лидерборд** и **локализацию**. Поэтому один раз выполните дополнительно:

**Шаг 1. Бэкап (на всякий случай).**
```bash
cd $APP
cp -a server/config/balance.custom.json ~/balance-backup.json 2>/dev/null || true
cp -a server/data ~/ad-data-backup 2>/dev/null || true
git rev-parse HEAD > ~/ad-prev-commit.txt      # запомнить версию для отката
```

**Шаг 2. Node ≥ 22.5** — нужен для статистики и лидерборда (встроенный `node:sqlite`).
```bash
node -v      # если ниже v22.5 — обновите:
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -   # 24 LTS (или setup_25.x)
apt-get install -y nodejs
```

**Шаг 3. Сбросить баланс к дефолту.** Старый `balance.custom.json` содержит поля
прежней схемы (`baseIncome`, `income`, `barricade` …), которые новая версия не
использует — из-за них экономика останется «вялой», как на старом балансе. Сброс:
```bash
rm -f $APP/server/config/balance.custom.json
```
(или после рестарта нажмите в админке **Баланс → «Сбросить к дефолту»**.)
После сброса заново внесите нужные правки — уже в новых полях.

Затем — обычный `git pull` + `restart` из 8.1.

### 8.3. Проверка после обновления

```bash
journalctl -u attackdefence -n 30 --no-pager
```
В логах при старте должно быть:
- `Attack & Defence — сервер запущен`
- `[db] статистика включена: …/stats.db` — значит Node ≥ 22.5 и БД работает
  (если вместо этого `node:sqlite недоступен` — обновите Node, шаг 2).

Затем откройте игру и админку:
- `http://ВАШ_IP/` — грузится, есть переключатель языка 🌐 и кнопка «🏆 Лидерборд».
- `http://ВАШ_IP/admin` → вкладки **«Аналитика»** и **«Матчи»** открываются.
- Сыграйте матч против бота — после него в «Аналитике» появятся цифры, в лидерборде — ваш рейтинг.

### 8.4. Откат, если что-то сломалось

```bash
cd $APP
git checkout $(cat ~/ad-prev-commit.txt)    # вернуться на прошлую версию
npm ci --omit=dev
systemctl restart attackdefence
```
Данные (`balance.custom.json`, `stats.db`) при откате не теряются — они вне git.

**Статистика и бэкапы.** База матчей — `server/data/stats.db`, правки баланса —
`server/config/balance.custom.json` (оба в `.gitignore`). Включите их в регулярные
бэкапы. Аналитика и лидерборд — в админке.

**Публикация в Яндекс Играх** — отдельная инструкция в [YANDEX.md](YANDEX.md):
архитектура (статический клиент на Яндексе + этот бэкенд по `wss://`), обязательный
домен/TLS, сборка бандла `npm run build:yandex`, чек-лист требований и расчёт мощностей.

---

## Будущий домен (заглушка → боевой)

Когда купите домен (например `game.example.com`):

1. **DNS**: A-запись `game.example.com → ВАШ_IP` (и `www`, если нужно).
2. **nginx**: в `/etc/nginx/sites-available/attackdefence` замените
   `server_name _;` на `server_name game.example.com;`, затем `nginx -t && systemctl reload nginx`.
3. **HTTPS** (бесплатный Let's Encrypt):
   ```bash
   apt install -y certbot python3-certbot-nginx
   certbot --nginx -d game.example.com
   ```
   Certbot сам перепишет конфиг на 443 и настроит автопродление.
   Клиент игры использует относительные адреса и сам перейдёт на `wss://` — правок кода не нужно.
4. **Приложение**: в `/opt/attackdefence/app.env` поменяйте
   `PUBLIC_ORIGIN=https://game.example.com` и выполните `systemctl restart attackdefence`
   (значение используется в логах/ссылках — на работу клиента не влияет).

## Диагностика

| Симптом | Что смотреть |
|---|---|
| Сайт не открывается | `systemctl status attackdefence`, `journalctl -u attackdefence -n 50`, `nginx -t` |
| «переподключение…» в меню | WebSocket не проходит: проверьте `location /ws` в nginx (заголовки Upgrade/Connection) |
| Админка не пускает | Пароль в `app.env`; после 5 неверных попыток IP блокируется на 5 минут |
| Изменил баланс — ничего не поменялось | Правки применяются только к матчам, начатым после сохранения |
| Порт 3000 занят | Поменяйте `PORT` в `app.env` и `proxy_pass` в nginx |

## Ориентировочная нагрузка

Один матч — это ~8 тиков симуляции в секунду и до пары сотен юнитов; VPS с 1 vCPU / 1 ГБ RAM
спокойно держит десятки одновременных матчей. Узкое место при росте — CPU; горизонтальное
масштабирование потребует вынести матчмейкинг (несколько инстансов за балансировщиком со
sticky-сессиями по `/ws`).
