// Локализация RU/EN. Язык определяется автоматически (SDK Яндекса -> браузер),
// переключается вручную кнопкой 🌐 и сохраняется в прогресс.
const DICTS = {
  ru: {
    menu: {
      sub: 'PvP tower defense на процедурных картах',
      name_label: 'Ваше имя', name_ph: 'Полководец',
      play: '⚔ В БОЙ', friend: '👥 Играть с другом', howto: 'Как играть',
      leaderboard: '🏆 Лидерборд',
      fullscreen: '⛶ На весь экран', fullscreen_exit: '🡼 Обычный режим',
    },
    conn: { online: '● сервер онлайн', reconnect: '● переподключение…', connecting: 'подключение…' },
    queue: {
      title: 'Поиск противника…', sec: 'сек', cancel: 'Отмена',
      hint1: 'Ищем достойного соперника среди игроков',
      hint2: 'Живых соперников не видно… готовим достойного бота',
    },
    hud: {
      units_title: 'Юниты <span class="hint">(выйдут в начале боя)</span>',
      buildings_title: 'Постройки <span class="hint">(на своей половине)</span>',
      gold_title: 'Золото и доход за раунд',
      income: (n) => `+${n} за раунд`,
      sd: '⚠ ВНЕЗАПНАЯ СМЕРТЬ — базы разрушаются!',
      phase_plan: (r, t) => `Раунд ${r} · планирование 0:${t}`,
      phase_battle: (r) => `⚔ Раунд ${r} · БОЙ`,
      you: ' (вы)',
      surrender_title: 'Сдаться', fs_title: 'На весь экран', fs_exit_title: 'Выйти из полного экрана',
    },
    chip: {
      remove: (name, cost) => `Убрать пачку (${name}) — вернёт ◉ ${cost}`,
      empty_plan: 'очередь пуста', empty_battle: 'войска в бою',
    },
    sel: { integrity: 'Прочность', sell_for: (n) => `Продать за ◉ ${n}` },
    place: {
      hint_desktop: 'Стройте на горах · ЛКМ — построить · ПКМ / Esc — отмена',
      hint_touch: 'Тапните по горам на своей половине, затем «✓ Построить»',
      build: '✓ Построить', cancel: '✕',
    },
    toast: {
      no_conn: 'Нет соединения с сервером', reconnected: 'Вы вернулись в бой!',
      battle: '⚔ Бой! Войска выходят',
      round: (r, g) => `Раунд ${r} · +${g} ◉ — планируйте!`,
      cant_here: 'Здесь строить нельзя',
      units_plan_only: 'Заказ юнитов — только в фазе планирования',
      build_plan_only: 'Строить можно только в фазе планирования',
      code_len: 'Код — 4 символа',
    },
    end: {
      win: '⚔ ПОБЕДА!', lose: 'Поражение', draw: 'Ничья', back: 'В главное меню',
      r_base_w: 'Вражеская база уничтожена!', r_base_l: 'Ваша база уничтожена',
      r_base_d: 'Обе базы пали одновременно',
      r_surr_w: 'Противник сдался', r_surr_l: 'Вы сдались',
      r_disc_w: 'Противник покинул бой', r_disc_l: 'Потеряно соединение',
      r_timeout: 'Время вышло — победил владелец более крепкой базы',
      r_draw: 'Абсолютное равенство сил', r_admin: 'Матч остановлен администратором',
      st_you: 'Вы', st_enemy: 'Противник', st_kills: 'Убито врагов',
      st_losses: 'Потеряно бойцов', st_hp: 'HP базы', st_dur: 'Длительность',
      st_dur_val: (m, s) => `${m} мин ${s} c`,
    },
    friend: {
      title: 'Игра с другом', create: 'Создать комнату', or: 'или войдите по коду от друга',
      join: 'Войти', wait: 'Ждём друга…', hint: 'Продиктуйте код или отправьте ссылку:',
      close: 'Закрыть', copied: 'Ссылка скопирована — отправьте её другу',
      copy_manual: 'Выделено — нажмите Ctrl+C',
    },
    lb: {
      title: '🏆 Лидерборд', empty: 'Пока пусто — сыграйте первый матч!',
      rank: '#', player: 'Игрок', rating: 'Рейтинг', wins: 'Победы',
      you: (rank, rating) => `Ваше место: ${rank} · рейтинг ${rating}`,
      you_none: 'Сыграйте матч, чтобы попасть в рейтинг', close: 'Закрыть',
      disabled: 'Лидерборд недоступен на этом сервере',
    },
    howto: {
      title: 'Как играть', ok: 'Понятно',
      html: `
      <div><b>🎯 Цель.</b> Уничтожьте вражескую базу раньше, чем уничтожат вашу. Игра идёт <b>раундами</b>: 20 секунд планирования → бой до гибели всех войск. После 10:30 — «внезапная смерть»: базы разрушаются сами.</div>
      <div><b>🕵 Скрытность.</b> Во время планирования <b>противника не видно</b>: его новые постройки и армия раскрываются только в момент выхода войск. Просчитывайте, чего ждать, — и блефуйте сами.</div>
      <div><b>◉ Экономика.</b> Золото выдаётся разом <b>в начале каждого раунда</b>. <b>Шахты</b> добавляют к выплате, <b>банки</b> умножают её. Вложение в экономику окупается через пару раундов — решайте, когда копить, а когда давить.</div>
      <div><b>⚔ Атака.</b> Юниты встают в очередь и выходят все разом в начале боя, дальше сражаются сами. С каждым раундом войска выходят <b>сильнее</b> (больше HP и урона) — поздние волны пробивают плотную оборону.</div>
      <div><b>🏰 Оборона.</b> Башни ставятся <b>на горах</b> и простреливают коридор сверху. Лучшие точки — изгибы коридора. Криобашня + пушка рядом = зона смерти.</div>
      <div><b>🗺 Карта.</b> Каждый матч — новый <b>извилистый коридор</b> между базами, прорезанный в горах. Юниты ходят только по коридору; строить можно только на горах своей половины. Лес в коридоре замедляет войска.</div>
      <div><b>⌨ Управление.</b> ПК: перетаскивание/стрелки — камера, колесо — зум, клавиши 1–6 — юниты, Q W E R T — постройки, Esc — отмена. Телефон (горизонтально): палец — камера, щипок — зум, тап по горе + «✓ Построить», долгое нажатие на кнопку — описание.</div>
      <div><b>👥 С другом.</b> Кнопка «Играть с другом»: создайте комнату и отправьте другу код или ссылку — он попадёт прямо к вам в матч. Кнопка «В бой» ищет случайного соперника (или бота через 20 секунд).</div>`,
    },
    rotate: 'Поверните телефон горизонтально',
    tut: {
      step: (a, b) => `Обучение · шаг ${a} из ${b}`, skip: 'Пропустить обучение', next: 'Далее →',
      s1: 'Добро пожаловать на поле боя, командир! Ваша цель — <b>уничтожить вражескую базу</b> раньше, чем падёт ваша. Игра идёт раундами: <b>20 секунд планирования</b>, затем <b>бой</b>, который длится до гибели всех войск.',
      s2: 'Это ваше <b>золото</b>. Оно выдаётся разом <b>в начале каждого раунда</b> — шахты и банки увеличивают выплату. Тратьте бюджет раунда с умом: что не потратили, перейдёт на следующий.',
      s3: 'Здесь нанимаются <b>юниты</b> — во время планирования они встают в <b>очередь</b> и выйдут все разом в начале боя. Противник ваших приготовлений <b>не видит</b> (как и вы его — его половина в тумане). Клик по чипу очереди отменяет пачку с возвратом золота.',
      s4_pc: '<b>Постройки</b> ставятся <b>на горах</b> своей половины (валидные клетки подсвечиваются): шахты и банки — доход, башни простреливают коридор. Лучшие места — <b>изгибы коридора</b>. Выберите постройку и кликните по горе.',
      s4_touch: '<b>Постройки</b> ставятся <b>на горах</b> своей половины (валидные клетки подсвечиваются): шахты и банки — доход, башни простреливают коридор. Лучшие места — <b>изгибы коридора</b>. Выберите постройку, тапните по горе и нажмите <b>«✓ Построить»</b>.',
      s5: 'Полоски сверху — <b>здоровье баз</b>, ваша слева. База умеет отстреливаться от одиночных врагов, но против волны нужна оборона.',
      s6_pc: 'Камера: <b>перетаскивание мышью</b> или стрелки, <b>колесо</b> — зум, миникарта внизу слева — быстрый переход. Совет: сперва отстройте 2–3 шахты, затем оборону, а после — атакуйте волнами. Удачи, командир!',
      s6_touch: 'Камера: <b>ведите пальцем</b> по карте, <b>щипок двумя пальцами</b> — зум, тап по миникарте внизу слева — быстрый переход. Долгое нажатие на кнопку в магазине покажет описание. Совет: сперва отстройте 2–3 шахты, затем оборону, а после — атакуйте волнами. Удачи, командир!',
    },
    tt: {
      hp: 'HP', dmg: 'Урон', vs_base: (n) => ` (×${n} по базе)`, rate: 'Атак/с',
      range: 'Дальность', speed: 'Скорость', armor: 'Броня',
      heal: (n) => `Лечение ${n}/с`, heal_r: (r) => `в радиусе ${r}`, pack: (n) => `Пачка: ${n} шт.`,
      income: (n) => `Доход +${n} за раунд`, income_mult: (p) => `Доход +${p}%`, max: (n) => `максимум ${n}`,
      splash: (n) => `Площадь взрыва: ${n}`, slow: (p, s) => `Замедление ${p}% на ${s}с`,
      firerate: (n) => `Скорострельность ${n}/с`, radius: (n) => `Радиус ${n}`,
    },
    confirm_surrender: 'Сдаться и покинуть бой?',
    units: {
      scout: ['Скаут', 'Быстрый и дешёвый разведчик. Хорош для ранних уколов и добивания.'],
      soldier: ['Солдат', 'Универсальный боец. Основа любой армии.'],
      archer: ['Лучница', 'Атакует издалека, но хрупкая. Прикрывайте её танками.'],
      tank: ['Танк', 'Медленный, но невероятно живучий. Идёт первым и держит урон.'],
      breaker: ['Разрушитель', 'Таран с мощным бонусным уроном по вражеской базе.'],
      healer: ['Целитель', 'Лечит союзников рядом. Не атакует.'],
    },
    blds: {
      mine: ['Шахта', 'Добывает золото каждый раунд. Фундамент вашей экономики.'],
      bank: ['Банк', '+25% ко всему доходу. Эффект складывается.'],
      arrow: ['Стрелковая башня', 'Надёжная башня с высокой скорострельностью.'],
      cannon: ['Пушка', 'Медленная, но бьёт по площади. Гроза толп.'],
      frost: ['Криобашня', 'Замедляет врагов в радиусе на 40%.'],
    },
    bots: {},
    bot_tag: ' [бот]',
  },

  en: {
    menu: {
      sub: 'PvP tower defense on procedural maps',
      name_label: 'Your name', name_ph: 'Commander',
      play: '⚔ TO BATTLE', friend: '👥 Play with a friend', howto: 'How to play',
      leaderboard: '🏆 Leaderboard',
      fullscreen: '⛶ Fullscreen', fullscreen_exit: '🡼 Exit fullscreen',
    },
    conn: { online: '● server online', reconnect: '● reconnecting…', connecting: 'connecting…' },
    queue: {
      title: 'Searching for an opponent…', sec: 'sec', cancel: 'Cancel',
      hint1: 'Looking for a worthy opponent among players',
      hint2: 'No live opponents in sight… preparing a worthy bot',
    },
    hud: {
      units_title: 'Units <span class="hint">(deploy when battle starts)</span>',
      buildings_title: 'Buildings <span class="hint">(on your half)</span>',
      gold_title: 'Gold and income per round',
      income: (n) => `+${n} per round`,
      sd: '⚠ SUDDEN DEATH — bases are crumbling!',
      phase_plan: (r, t) => `Round ${r} · planning 0:${t}`,
      phase_battle: (r) => `⚔ Round ${r} · BATTLE`,
      you: ' (you)',
      surrender_title: 'Surrender', fs_title: 'Fullscreen', fs_exit_title: 'Exit fullscreen',
    },
    chip: {
      remove: (name, cost) => `Remove squad (${name}) — refunds ◉ ${cost}`,
      empty_plan: 'queue is empty', empty_battle: 'troops in battle',
    },
    sel: { integrity: 'Integrity', sell_for: (n) => `Sell for ◉ ${n}` },
    place: {
      hint_desktop: 'Build on mountains · LMB — build · RMB / Esc — cancel',
      hint_touch: 'Tap a mountain on your half, then “✓ Build”',
      build: '✓ Build', cancel: '✕',
    },
    toast: {
      no_conn: 'No connection to server', reconnected: 'You are back in the fight!',
      battle: '⚔ Battle! Troops are deploying',
      round: (r, g) => `Round ${r} · +${g} ◉ — plan your move!`,
      cant_here: "Can't build here",
      units_plan_only: 'Units can only be queued during planning',
      build_plan_only: 'You can only build during planning',
      code_len: 'Code is 4 characters',
    },
    end: {
      win: '⚔ VICTORY!', lose: 'Defeat', draw: 'Draw', back: 'Main menu',
      r_base_w: 'Enemy base destroyed!', r_base_l: 'Your base was destroyed',
      r_base_d: 'Both bases fell at once',
      r_surr_w: 'Opponent surrendered', r_surr_l: 'You surrendered',
      r_disc_w: 'Opponent left the battle', r_disc_l: 'Connection lost',
      r_timeout: 'Time is up — the sturdier base wins',
      r_draw: 'A perfect stalemate', r_admin: 'Match stopped by administrator',
      st_you: 'You', st_enemy: 'Enemy', st_kills: 'Enemies killed',
      st_losses: 'Troops lost', st_hp: 'Base HP', st_dur: 'Duration',
      st_dur_val: (m, s) => `${m} min ${s} s`,
    },
    friend: {
      title: 'Play with a friend', create: 'Create a room', or: 'or enter a code from your friend',
      join: 'Join', wait: 'Waiting for your friend…', hint: 'Share the code or send the link:',
      close: 'Close', copied: 'Link copied — send it to your friend',
      copy_manual: 'Selected — press Ctrl+C',
    },
    lb: {
      title: '🏆 Leaderboard', empty: 'Nothing here yet — play your first match!',
      rank: '#', player: 'Player', rating: 'Rating', wins: 'Wins',
      you: (rank, rating) => `Your place: ${rank} · rating ${rating}`,
      you_none: 'Play a match to enter the ranking', close: 'Close',
      disabled: 'Leaderboard is not available on this server',
    },
    howto: {
      title: 'How to play', ok: 'Got it',
      html: `
      <div><b>🎯 Goal.</b> Destroy the enemy base before yours falls. The game is played in <b>rounds</b>: 20 seconds of planning → a battle until all troops are dead. After 10:30 — “sudden death”: bases crumble on their own.</div>
      <div><b>🕵 Fog of war.</b> During planning <b>the enemy is hidden</b>: their new buildings and army are revealed only when troops deploy. Predict what is coming — and bluff yourself.</div>
      <div><b>◉ Economy.</b> Gold is paid out in a lump sum <b>at the start of each round</b>. <b>Mines</b> add to the payout, <b>banks</b> multiply it. Economy pays off within a couple of rounds — decide when to grow and when to push.</div>
      <div><b>⚔ Attack.</b> Units go into a queue and deploy all at once when the battle starts, then fight on their own. Each round troops deploy <b>stronger</b> (more HP and damage) — late waves crack dense defenses.</div>
      <div><b>🏰 Defense.</b> Towers are built <b>on mountains</b> and shoot down into the corridor. The best spots are corridor bends. Frost tower + cannon nearby = kill zone.</div>
      <div><b>🗺 Map.</b> Every match generates a new <b>winding corridor</b> between the bases, carved through mountains. Units walk only along the corridor; you can build only on mountains of your half. Forest in the corridor slows troops.</div>
      <div><b>⌨ Controls.</b> PC: drag/arrows — camera, wheel — zoom, keys 1–6 — units, Q W E R T — buildings, Esc — cancel. Phone (landscape): finger — camera, pinch — zoom, tap a mountain + “✓ Build”, long-press a button for details.</div>
      <div><b>👥 With a friend.</b> “Play with a friend”: create a room and send the code or link — your friend lands right into your match. “To battle” finds a random opponent (or a bot after 20 seconds).</div>`,
    },
    rotate: 'Rotate your phone to landscape',
    tut: {
      step: (a, b) => `Tutorial · step ${a} of ${b}`, skip: 'Skip tutorial', next: 'Next →',
      s1: 'Welcome to the battlefield, commander! Your goal is to <b>destroy the enemy base</b> before yours falls. The game is played in rounds: <b>20 seconds of planning</b>, then a <b>battle</b> that lasts until all troops are dead.',
      s2: 'This is your <b>gold</b>. It is paid out in a lump sum <b>at the start of each round</b> — mines and banks increase the payout. Spend the round budget wisely: whatever you save carries over.',
      s3: 'Hire <b>units</b> here — during planning they go into a <b>queue</b> and deploy all at once when the battle starts. The enemy <b>cannot see</b> your preparations (nor you theirs — their half is fogged). Click a queue chip to cancel a squad with a full refund.',
      s4_pc: '<b>Buildings</b> go <b>on mountains</b> of your half (valid cells are highlighted): mines and banks — income, towers cover the corridor. The best spots are <b>corridor bends</b>. Pick a building and click a mountain.',
      s4_touch: '<b>Buildings</b> go <b>on mountains</b> of your half (valid cells are highlighted): mines and banks — income, towers cover the corridor. The best spots are <b>corridor bends</b>. Pick a building, tap a mountain and press <b>“✓ Build”</b>.',
      s5: 'The bars on top are the <b>bases’ health</b>, yours on the left. The base can fend off single enemies, but a wave needs proper defense.',
      s6_pc: 'Camera: <b>drag with the mouse</b> or arrows, <b>wheel</b> — zoom, minimap in the bottom-left — quick jump. Tip: build 2–3 mines first, then defense, then attack in waves. Good luck, commander!',
      s6_touch: 'Camera: <b>drag with your finger</b>, <b>pinch</b> — zoom, tap the minimap in the bottom-left — quick jump. Long-press a shop button for details. Tip: build 2–3 mines first, then defense, then attack in waves. Good luck, commander!',
    },
    tt: {
      hp: 'HP', dmg: 'Damage', vs_base: (n) => ` (×${n} vs base)`, rate: 'Attacks/s',
      range: 'Range', speed: 'Speed', armor: 'Armor',
      heal: (n) => `Heals ${n}/s`, heal_r: (r) => `within ${r}`, pack: (n) => `Squad: ${n}`,
      income: (n) => `Income +${n} per round`, income_mult: (p) => `Income +${p}%`, max: (n) => `max ${n}`,
      splash: (n) => `Blast radius: ${n}`, slow: (p, s) => `Slows ${p}% for ${s}s`,
      firerate: (n) => `Fire rate ${n}/s`, radius: (n) => `Radius ${n}`,
    },
    confirm_surrender: 'Surrender and leave the battle?',
    units: {
      scout: ['Scout', 'Fast and cheap recon. Great for early pokes and finishing off.'],
      soldier: ['Soldier', 'A versatile fighter. The backbone of any army.'],
      archer: ['Archer', 'Attacks from afar but fragile. Screen her with tanks.'],
      tank: ['Tank', 'Slow but incredibly durable. Leads the charge and soaks damage.'],
      breaker: ['Breaker', 'A ram with massive bonus damage to the enemy base.'],
      healer: ['Healer', 'Heals nearby allies. Does not attack.'],
    },
    blds: {
      mine: ['Mine', 'Produces gold every round. The foundation of your economy.'],
      bank: ['Bank', '+25% to all income. Effects stack.'],
      arrow: ['Arrow Tower', 'A reliable tower with a high fire rate.'],
      cannon: ['Cannon', 'Slow but hits an area. The bane of crowds.'],
      frost: ['Frost Tower', 'Slows enemies in radius by 40%.'],
    },
    bots: {
      'Генерал Оникс': 'General Onyx', 'Командор Вега': 'Commander Vega',
      'Маршал Гром': 'Marshal Thunder', 'Стратег Ирбис': 'Strategist Irbis',
      'Полковник Шторм': 'Colonel Storm',
    },
    bot_tag: ' [bot]',
    // Перевод серверных сообщений об ошибках (сервер отвечает по-русски).
    errors: {
      'Матч завершён': 'Match is over',
      'Дождитесь фазы планирования': 'Wait for the planning phase',
      'Неизвестный юнит': 'Unknown unit',
      'Недостаточно золота': 'Not enough gold',
      'Достигнут лимит армии': 'Army limit reached',
      'Очередь уже вышла в бой': 'The queue has already deployed',
      'В очереди нет таких юнитов': 'No such units in the queue',
      'Строить можно только в фазе планирования': 'You can only build during planning',
      'Неизвестная постройка': 'Unknown building',
      'Вне карты': 'Out of map',
      'Строить можно только на горах': 'You can only build on mountains',
      'Клетка занята': 'Cell is occupied',
      'Строить можно только на своей половине': 'You can only build on your half',
      'Продавать можно только в фазе планирования': 'You can only sell during planning',
      'Постройка не найдена': 'Building not found',
      'Комната не найдена. Проверьте код — возможно, друг её закрыл.': 'Room not found. Check the code — your friend may have closed it.',
      'Это ваша собственная комната — отправьте код другу.': 'This is your own room — send the code to a friend.',
      'Создатель комнаты отключился.': 'The room owner disconnected.',
    },
  },
};

export let lang = 'ru';

export function setLang(l) {
  lang = DICTS[l] ? l : 'ru';
  try { localStorage.setItem('ad_lang', lang); } catch (_) {}
}

export function detectLang(sdkLang) {
  try {
    const saved = localStorage.getItem('ad_lang');
    if (saved && DICTS[saved]) { lang = saved; return lang; }
  } catch (_) {}
  const cand = (sdkLang || (typeof navigator !== 'undefined' && navigator.language) || 'ru').slice(0, 2).toLowerCase();
  lang = cand === 'ru' || cand === 'be' || cand === 'kk' || cand === 'uk' ? 'ru' : 'en';
  return lang;
}

// t('menu.play') или t('hud.income', 25) для функций-шаблонов.
export function t(path, ...args) {
  const parts = path.split('.');
  let cur = DICTS[lang];
  for (const p of parts) cur = cur && cur[p];
  if (cur === undefined) { // фолбэк на русский
    cur = DICTS.ru;
    for (const p of parts) cur = cur && cur[p];
  }
  if (typeof cur === 'function') return cur(...args);
  return cur !== undefined ? cur : path;
}

export function unitName(key, fallback) { return (t(`units.${key}`) || [])[0] || fallback || key; }
export function unitDesc(key, fallback) { return (t(`units.${key}`) || [])[1] || fallback || ''; }
export function bldName(key, fallback) { return (t(`blds.${key}`) || [])[0] || fallback || key; }
export function bldDesc(key, fallback) { return (t(`blds.${key}`) || [])[1] || fallback || ''; }

// Серверные ошибки приходят по-русски; для en переводим по словарю (динамический "Максимум N шт." — regex).
export function trError(msg) {
  if (lang === 'ru' || !msg) return msg;
  const dict = DICTS.en.errors;
  if (dict[msg]) return dict[msg];
  const m = /^Максимум (\d+) шт\.$/.exec(msg);
  if (m) return `Maximum ${m[1]}`;
  return msg;
}

// Имя игрока/бота: для en переводим имена ботов и суффикс.
export function trPlayerName(name) {
  if (lang === 'ru' || !name) return name;
  let out = name;
  for (const [ru, en] of Object.entries(DICTS.en.bots)) out = out.replace(ru, en);
  out = out.replace(' [бот]', DICTS.en.bot_tag);
  return out;
}
