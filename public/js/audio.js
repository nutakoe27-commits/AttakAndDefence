// Звук на чистом WebAudio (без файлов — компактно и безопасно для CSP Яндекса).
//
// Защита от «каши из звуков» — три уровня:
//  1) throttle по категориям: каждый тип звука имеет минимальный интервал;
//  2) агрегация за кадр: renderer сыплет десятки событий боя — мы копим их и
//     раз в flush-окно проигрываем ОДИН представитель категории (громче, если много);
//  3) глобальный лимит одновременных голосов: не больше N активных источников.
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;              // включён ли звук (кнопка + сохранение)
    this.muted = false;               // временно (сворачивание/реклама)
    this.voices = 0;                  // активных источников (для лимита)
    this.maxVoices = 10;
    this.last = {};                   // время последнего звука по категории
    this.pending = {};                // накопленные события категории за flush-окно
    this.flushTimer = null;

    // Минимальный интервал между звуками категории, мс.
    this.throttle = {
      ui: 40, build: 90, spawn: 130, shot: 75, hit: 80, boom: 130,
      die: 100, basehit: 160, frost: 220, heal: 300,
      round: 0, battle: 0, win: 0, lose: 0, error: 120,
    };

    try { this.enabled = localStorage.getItem('ad_sound') !== '0'; } catch (_) {}
  }

  // Инициализация только по жесту пользователя (политика автоплея браузеров).
  ensure() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch (_) { this.ctx = null; }
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('ad_sound', on ? '1' : '0'); } catch (_) {}
    if (on) { this.ensure(); this.resume(); }
  }
  toggle() { this.setEnabled(!this.enabled); return this.enabled; }

  // Внешняя пауза (сворачивание вкладки, реклама) — глушим, но не меняем выбор игрока.
  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    try { if (m) this.ctx.suspend(); else if (this.enabled) this.ctx.resume(); } catch (_) {}
  }
  resume() { if (this.ctx && !this.muted && this.enabled) { try { this.ctx.resume(); } catch (_) {} } }

  get on() { return this.enabled && !this.muted && !!this.ctx; }

  // ---------- Низкоуровневый синтез ----------
  // tone: короткий тон с экспоненциальной атакой/спадом.
  tone({ freq = 440, type = 'sine', dur = 0.12, vol = 0.3, freq2 = null, attack = 0.005 }) {
    if (!this.on || this.voices >= this.maxVoices) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    this.voices++;
    osc.onended = () => { this.voices--; };
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // noiseBurst: отфильтрованный шум (взрывы, удары).
  noiseBurst({ dur = 0.18, vol = 0.25, freq = 800, q = 1, type = 'lowpass' }) {
    if (!this.on || this.voices >= this.maxVoices) return;
    const t0 = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---------- Пресеты звуков ----------
  play(cat, intensity = 1) {
    if (!this.on) return;
    const now = performance.now();
    const gap = this.throttle[cat] ?? 80;
    if (gap && this.last[cat] && now - this.last[cat] < gap) return;
    this.last[cat] = now;
    const boost = Math.min(1.6, 1 + Math.log2(1 + intensity) * 0.25); // больше событий — чуть громче
    switch (cat) {
      case 'ui': this.tone({ freq: 520, type: 'triangle', dur: 0.07, vol: 0.18 }); break;
      case 'build': this.tone({ freq: 180, freq2: 90, type: 'sine', dur: 0.16, vol: 0.28 }); this.noiseBurst({ dur: 0.1, vol: 0.12, freq: 500 }); break;
      case 'spawn': this.tone({ freq: 300, freq2: 500, type: 'sawtooth', dur: 0.18, vol: 0.16 }); break;
      case 'shot': this.tone({ freq: 900, freq2: 500, type: 'square', dur: 0.06, vol: 0.08 * boost }); break;
      case 'hit': this.noiseBurst({ dur: 0.05, vol: 0.08 * boost, freq: 2200, type: 'bandpass', q: 1.5 }); break;
      case 'boom': this.noiseBurst({ dur: 0.28, vol: 0.24 * boost, freq: 320 }); this.tone({ freq: 90, freq2: 45, type: 'sine', dur: 0.26, vol: 0.2 }); break;
      case 'die': this.tone({ freq: 240, freq2: 110, type: 'triangle', dur: 0.14, vol: 0.1 * boost }); break;
      case 'basehit': this.tone({ freq: 130, freq2: 70, type: 'sine', dur: 0.2, vol: 0.22 }); this.noiseBurst({ dur: 0.12, vol: 0.12, freq: 400 }); break;
      case 'frost': this.tone({ freq: 1200, freq2: 1800, type: 'sine', dur: 0.22, vol: 0.1 }); break;
      case 'heal': this.tone({ freq: 660, freq2: 990, type: 'sine', dur: 0.16, vol: 0.09 }); break;
      case 'round': this.arpeggio([392, 523], 'triangle', 0.12, 0.2); break;
      case 'battle': this.arpeggio([330, 262, 196], 'sawtooth', 0.14, 0.22); break;
      case 'win': this.arpeggio([523, 659, 784, 1047], 'triangle', 0.14, 0.26); break;
      case 'lose': this.arpeggio([392, 330, 262, 196], 'sine', 0.18, 0.24); break;
      case 'error': this.tone({ freq: 200, freq2: 150, type: 'square', dur: 0.12, vol: 0.14 }); break;
    }
  }

  arpeggio(freqs, type, step, vol) {
    if (!this.on) return;
    freqs.forEach((f, i) => setTimeout(() => this.tone({ freq: f, type, dur: step * 1.4, vol }), i * step * 1000));
  }

  // ---------- Агрегация игровых событий ----------
  // Renderer вызывает это на КАЖДОЕ событие боя. Мы копим по категориям и
  // сбрасываем раз в ~50 мс, играя один звук на категорию (с учётом количества).
  gameEvent(type) {
    if (!this.on) return;
    const cat = EVENT_MAP[type];
    if (!cat) return;
    this.pending[cat] = (this.pending[cat] || 0) + 1;
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 50);
  }

  flush() {
    this.flushTimer = null;
    for (const cat of Object.keys(this.pending)) {
      const n = this.pending[cat];
      this.play(cat, n);
    }
    this.pending = {};
  }

  // Дискретные UI/фазовые звуки — сразу, без агрегации.
  ui() { this.ensure(); this.play('ui'); }
  cue(cat) { this.ensure(); this.play(cat); }
}

// Событие симуляции -> звуковая категория.
const EVENT_MAP = {
  hit: 'hit', proj: 'shot', boom: 'boom', die: 'die', bdie: 'boom',
  basehit: 'basehit', build: 'build', spawn: 'spawn', frost: 'frost', heal: 'heal',
};

export const audio = new AudioEngine();
