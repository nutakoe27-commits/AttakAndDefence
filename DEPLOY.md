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

```bash
cd /opt/attackdefence/app
sudo -u gameadmin git pull
sudo -u gameadmin npm ci --omit=dev
systemctl restart attackdefence
```

Правки баланса из админки хранятся в `server/config/balance.custom.json`
(файл в `.gitignore`) — обновления кода их не затирают. Этот файл стоит включить
в бэкапы, если настраиваете их.

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
