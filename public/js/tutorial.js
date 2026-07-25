// Обучение: пошаговый оверлей при первом матче. Тексты — из i18n.
import { Ya } from './yandex.js';
import { t } from './i18n.js';

const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Ключи шагов + якоря подсветки; текст берётся из словаря в момент показа.
const STEPS = [
  { key: 's1', anchor: null },
  { key: 's2', anchor: '#hud-gold-wrap' },
  { key: 's3', anchor: '#units-panel' },
  { key: IS_TOUCH ? 's4_touch' : 's4_pc', anchor: '#build-panel' },
  { key: 's5', anchor: '#hud-top' },
  { key: IS_TOUCH ? 's6_touch' : 's6_pc', anchor: null },
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
    this.stepNum.textContent = t('tut.step', this.step + 1, STEPS.length);
    this.textEl.innerHTML = t(`tut.${s.key}`);
    this.clearHighlight();
    if (s.anchor) {
      const el = document.querySelector(s.anchor);
      if (el) {
        el.classList.add('tut-highlight');
        this.highlighted = el;
        const r = el.getBoundingClientRect();
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
    Ya.save({ tutorial_done: '1' }); // облачное сохранение прогресса
  }
}
