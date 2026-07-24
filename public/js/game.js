// Состояние матча на клиенте: хранит снапшоты сервера и интерполирует между ними.
export class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.map = null;
    this.balance = null;
    this.mySlot = 0;
    this.matchId = null;
    this.playersMeta = [];
    this.prev = null;     // предыдущий снапшот
    this.curr = null;     // последний снапшот
    this.currAt = 0;      // performance.now() получения
    this.tickInterval = 125;
    this.over = false;
    this.winner = null;
    this.reason = null;
  }

  init(data) {
    this.reset();
    this.map = data.map;
    this.balance = data.balance;
    this.mySlot = data.yourSlot;
    this.matchId = data.matchId;
    this.playersMeta = data.players;
    this.tickInterval = 1000 / (data.balance.match.tickRate || 8);
  }

  pushSnapshot(s, onEvent) {
    this.prev = this.curr;
    this.curr = s;
    this.currAt = performance.now();
    if (s.events) for (const ev of s.events) onEvent(ev);
    if (s.over) { this.over = true; this.winner = s.winner; this.reason = s.reason; }
  }

  // Интерполированное состояние для рендера.
  interpolated() {
    if (!this.curr) return null;
    const now = performance.now();
    // рендерим с задержкой в один тик, чтобы всегда был интервал для интерполяции
    let alpha = (now - this.currAt) / this.tickInterval;
    alpha = Math.max(0, Math.min(1, alpha));

    const unpackU = (a) => ({ id: a[0], owner: a[1], type: a[2], x: a[3], y: a[4], hp: a[5], dir: a[6], slowed: !!a[7] });
    const unpackB = (a) => ({ id: a[0], owner: a[1], type: a[2], cx: a[3], cy: a[4], hp: a[5] });

    const currUnits = this.curr.units.map(unpackU);
    let units = currUnits;
    if (this.prev) {
      const prevById = new Map(this.prev.units.map(a => [a[0], unpackU(a)]));
      units = currUnits.map(u => {
        const p = prevById.get(u.id);
        if (!p) return u;
        let dd = u.dir - p.dir;
        if (dd > Math.PI) dd -= Math.PI * 2;
        if (dd < -Math.PI) dd += Math.PI * 2;
        return {
          ...u,
          x: p.x + (u.x - p.x) * alpha,
          y: p.y + (u.y - p.y) * alpha,
          dir: p.dir + dd * alpha,
        };
      });
    }
    return {
      time: this.curr.time,
      sd: this.curr.sd,
      phase: this.curr.phase,
      round: this.curr.round,
      planLeft: this.curr.planLeft,
      myQueue: this.curr.myQueue || {},
      players: this.curr.players,
      units,
      buildings: this.curr.buildings.map(unpackB),
    };
  }

  me() { return this.curr ? this.curr.players[this.mySlot] : null; }
  enemy() { return this.curr ? this.curr.players[1 - this.mySlot] : null; }
}
