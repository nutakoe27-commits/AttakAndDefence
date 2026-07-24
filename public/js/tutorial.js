// Обучение: пошаговый оверлей при первом матче.
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const STEPS = [
  {
    text: 'Добро пожаловать на поле боя, командир! Ваша цель — <b>уничтожить вражескую базу</b> раньше, чем падёт ваша. Игра идёт раундами: <b>20 секунд планирования</b>, затем <b>бой</b>, который длится до гибели всех войск.',
    anchor: null,
  },
  {
    text: 'Это ваше <b>золото</b>. Оно выдаётся разом <b>в начале каждого раунда</b> — шахты и банки увеличивают выплату. Тратьте бюджет раунда с умом: что не потратили, перейдёт на следующий.',
    anchor: '#hud-gold-wrap',
  },
  {
    text: 'Здесь нанимаются <b>юниты</b> — во время планирования они встают в <b>очередь</b> и выйдут все разом в начале боя. Противник ваших приготовлений <b>не видит</b> (как и вы его — его половина в тумане). Клик по чипу очереди отменяет пачку с возвратом золота.',
    anchor: '#units-panel',
  },
  {
    text: IS_TOUCH
      ? '<b>Постройки</b> ставятся на своей половине в фазе планирования: шахты и банки ускоряют доход, башни защищают проходы. <b>Баррикады не пропускают никого</b> — даже ваши войска пойдут в обход или будут ломать их. Выберите постройку, тапните по земле и нажмите <b>«✓ Построить»</b>.'
      : '<b>Постройки</b> ставятся на своей половине в фазе планирования: шахты и банки ускоряют доход, башни защищают проходы. <b>Баррикады не пропускают никого</b> — даже ваши войска пойдут в обход или будут ломать их. Выберите постройку и кликните по земле.',
    anchor: '#build-panel',
  },
  {
    text: 'Полоски сверху — <b>здоровье баз</b>, ваша слева. База умеет отстреливаться от одиночных врагов, но против волны нужна оборона.',
    anchor: '#hud-top',
  },
  {
    text: IS_TOUCH
      ? 'Камера: <b>ведите пальцем</b> по карте, <b>щипок двумя пальцами</b> — зум, тап по миникарте внизу слева — быстрый переход. Долгое нажатие на кнопку в магазине покажет описание. Совет: сперва отстройте 2–3 шахты, затем оборону, а после — атакуйте волнами. Удачи, командир!'
      : 'Камера: <b>перетаскивание мышью</b> или стрелки, <b>колесо</b> — зум, миникарта внизу слева — быстрый переход. Совет: сперва отстройте 2–3 шахты, затем оборону, а после — атакуйте волнами. Удачи, командир!',
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
