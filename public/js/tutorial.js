// Обучение: пошаговый оверлей при первом матче.
const STEPS = [
  {
    text: 'Добро пожаловать на поле боя, командир! Ваша цель — <b>уничтожить вражескую базу</b> (справа на карте) раньше, чем падёт ваша. Матч длится 10–15 минут.',
    anchor: null,
  },
  {
    text: 'Это ваше <b>золото</b> и доход в секунду. Золото капает само, а тратится на юнитов и постройки. Кто лучше распорядится экономикой — тот победит.',
    anchor: '#hud-gold-wrap',
  },
  {
    text: 'Здесь нанимаются <b>юниты</b> — они покупаются пачками и сами бегут к вражеской базе, атакуя всё на пути. Начните с пары пачек солдат (клавиша 2).',
    anchor: '#units-panel',
  },
  {
    text: '<b>Постройки</b> ставятся на своей половине карты: шахты и банки ускоряют доход, башни защищают проходы, баррикады перегораживают путь. Выберите постройку и кликните по земле.',
    anchor: '#build-panel',
  },
  {
    text: 'Полоски сверху — <b>здоровье баз</b>, ваша слева. База умеет отстреливаться от одиночных врагов, но против волны нужна оборона.',
    anchor: '#hud-top',
  },
  {
    text: 'Камера: <b>перетаскивание мышью</b> или стрелки, <b>колесо</b> — зум, миникарта внизу слева — быстрый переход. Совет: сперва отстройте 2–3 шахты, затем оборону, а после — атакуйте волнами. Удачи, командир!',
    anchor: null,
  },
];

export class Tutorial {
  constructor() {
    this.overlay = document.getElementById('tutorial-overlay');
    this.box = document.getElementById('tutorial-box');
    this.stepNum = document.getElementById('tutorial-step-num');
    this.textEl = document.getElementById('tutorial-text');
    this.step = 0;
    this.active = false;
    this.highlighted = null;
    document.getElementById('btn-tut-next').addEventListener('click', () => this.next());
    document.getElementById('btn-tut-skip').addEventListener('click', () => this.finish());
  }

  shouldShow() { return !localStorage.getItem('ad_tutorial_done'); }

  start() {
    this.step = 0;
    this.active = true;
    this.overlay.classList.remove('hidden');
    this.show();
  }

  show() {
    const s = STEPS[this.step];
    this.stepNum.textContent = `Обучение · шаг ${this.step + 1} из ${STEPS.length}`;
    this.textEl.innerHTML = s.text;
    this.clearHighlight();
    if (s.anchor) {
      const el = document.querySelector(s.anchor);
      if (el) {
        el.classList.add('tut-highlight');
        this.highlighted = el;
        const r = el.getBoundingClientRect();
        // Бокс — рядом с подсвеченным элементом, не вылезая за экран.
        let top = r.bottom + 14;
        if (top + 190 > window.innerHeight) top = r.top - 200;
        let left = r.left + r.width / 2 - 170;
        left = Math.max(12, Math.min(window.innerWidth - 360, left));
        this.box.style.top = top + 'px';
        this.box.style.left = left + 'px';
        return;
      }
    }
    this.box.style.top = '50%';
    this.box.style.left = '50%';
    this.box.style.transform = 'translate(-50%,-50%)';
  }

  next() {
    this.box.style.transform = '';
    this.step++;
    if (this.step >= STEPS.length) this.finish();
    else this.show();
  }

  clearHighlight() {
    if (this.highlighted) { this.highlighted.classList.remove('tut-highlight'); this.highlighted = null; }
  }

  finish() {
    this.active = false;
    this.clearHighlight();
    this.box.style.transform = '';
    this.overlay.classList.add('hidden');
    localStorage.setItem('ad_tutorial_done', '1');
  }
}
