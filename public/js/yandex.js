// Тонкая обёртка над SDK Яндекс Игр.
// Ключевая идея: без SDK (наш собственный VPS-хостинг) ВСЕ методы безопасно
// превращаются в no-op, поэтому один и тот же клиент работает и на Яндексе,
// и на своём сервере без единой правки кода.
export const Ya = {
  sdk: null,
  player: null,
  lang: 'ru',
  available: false,
  _gameplayActive: false,

  async init() {
    if (typeof window === 'undefined' || !window.YaGames) return;
    try {
      this.sdk = await window.YaGames.init();
      this.available = true;
      try { this.lang = this.sdk.environment.i18n.lang || 'ru'; } catch (_) {}
      // getPlayer со scopes:false работает и для гостя — облачное сохранение прогресса.
      try { this.player = await this.sdk.getPlayer({ scopes: false }); } catch (_) {}
      // События паузы/возобновления от платформы (реклама, сворачивание).
      try {
        this.sdk.on('game_api_pause', () => this._emit('pause'));
        this.sdk.on('game_api_resume', () => this._emit('resume'));
      } catch (_) {}
      console.log('[ya] SDK инициализирован, язык:', this.lang);
    } catch (e) {
      console.warn('[ya] SDK init не удался, играем без интеграции:', e && e.message);
    }
  },

  // Сообщаем платформе, что загрузка завершена и можно играть (обязательный вызов).
  loadingReady() {
    try { this.sdk && this.sdk.features.LoadingAPI.ready(); } catch (_) {}
  },

  // Разметка активного геймплея (для корректной паузы рекламы).
  gameplayStart() {
    if (this._gameplayActive) return;
    this._gameplayActive = true;
    try { this.sdk && this.sdk.features.GameplayAPI.start(); } catch (_) {}
  },
  gameplayStop() {
    if (!this._gameplayActive) return;
    this._gameplayActive = false;
    try { this.sdk && this.sdk.features.GameplayAPI.stop(); } catch (_) {}
  },

  // Полноэкранная реклама в логической паузе (между матчами). Возвращает Promise,
  // который резолвится в любом случае — чтобы не блокировать переход по экранам.
  showInterstitial() {
    return new Promise((resolve) => {
      if (!this.sdk) { resolve(false); return; }
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        this.sdk.adv.showFullscreenAdv({
          callbacks: {
            onClose: (wasShown) => fin(!!wasShown),
            onError: () => fin(false),
          },
        });
      } catch (_) { fin(false); }
      setTimeout(() => fin(false), 8000); // страховка
    });
  },

  // Показ/скрытие стики-баннера (единственный допустимый доп. блок).
  showBanner() { try { this.sdk && this.sdk.adv.showBannerAdv(); } catch (_) {} },
  hideBanner() { try { this.sdk && this.sdk.adv.hideBannerAdv(); } catch (_) {} },

  // ---------- Сохранение прогресса (облако + локальный фолбэк) ----------
  async save(obj) {
    try {
      if (this.player) { await this.player.setData(obj, true); return; }
    } catch (_) {}
    try { for (const k of Object.keys(obj)) localStorage.setItem('ad_' + k, typeof obj[k] === 'string' ? obj[k] : JSON.stringify(obj[k])); } catch (_) {}
  },
  async loadAll() {
    try {
      if (this.player) { return (await this.player.getData()) || {}; }
    } catch (_) {}
    // Фолбэк: собираем известные ключи из localStorage.
    const out = {};
    try {
      for (const key of ['name', 'tutorial_done']) {
        const v = localStorage.getItem('ad_' + key);
        if (v !== null) out[key] = v;
      }
    } catch (_) {}
    return out;
  },

  // Нативный лидерборд Яндекса: отправляем рейтинг (лидерборд 'rating'
  // нужно создать в Консоли разработчика; без него вызов молча игнорируется).
  submitScore(score) {
    if (!this.sdk || !isFinite(score)) return;
    this.sdk.getLeaderboards()
      .then(lb => lb.setLeaderboardScore('rating', Math.max(0, Math.round(score))))
      .catch(() => {});
  },

  // ---------- Простая шина событий паузы ----------
  _handlers: { pause: [], resume: [] },
  on(ev, fn) { if (this._handlers[ev]) this._handlers[ev].push(fn); },
  _emit(ev) { (this._handlers[ev] || []).forEach(fn => { try { fn(); } catch (_) {} }); },
};
