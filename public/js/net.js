// Сетевой слой: WebSocket с автопереподключением и токеном игрока (реконнект в бой).
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.connected = false;
    this.token = localStorage.getItem('ad_token') || null;
    this.reconnectDelay = 500;
    this.shouldReconnect = true;
  }

  on(type, fn) { this.handlers[type] = fn; }
  emit(type, msg) { if (this.handlers[type]) this.handlers[type](msg); }

  connect() {
    // Если задан внешний бэкенд (сборка под Яндекс Игры) — идём на него,
    // иначе на тот же origin (собственный VPS-хостинг).
    let url;
    if (typeof window !== 'undefined' && window.AD_BACKEND) {
      url = window.AD_BACKEND;
    } else {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url = `${proto}//${location.host}/ws`;
    }
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 500;
      this.send({ t: 'hello', token: this.token, name: localStorage.getItem('ad_name') || '' });
      this.emit('_open');
    };
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'hello') {
        this.token = msg.token;
        localStorage.setItem('ad_token', msg.token);
      }
      this.emit(msg.t, msg);
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.emit('_close');
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(8000, this.reconnectDelay * 1.7);
      }
    };
    this.ws.onerror = () => { try { this.ws.close(); } catch {} };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
}
