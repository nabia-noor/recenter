import { randomUUID } from "node:crypto";

export const HOLD_MS = 5000;
export const MAX_HEARTBEAT_GAP_MS = 500;
export class HoldGuard {
  private active: { token: string; start: number; last: number } | null = null;
  private now: () => number;
  constructor(now = () => performance.now()) {
    this.now = now;
  }
  begin() {
    const now = this.now();
    this.active = { token: randomUUID(), start: now, last: now };
    return { token: this.active.token, elapsed: 0, dismissed: false };
  }
  pulse(token: string) {
    const now = this.now();
    const active = this.active;
    if (!active || active.token !== token)
      return { token: null, elapsed: 0, dismissed: false };
    if (now < active.last || now - active.last > MAX_HEARTBEAT_GAP_MS) {
      this.active = null;
      return { token: null, elapsed: 0, dismissed: false };
    }
    active.last = now;
    const elapsed = now - active.start;
    if (elapsed >= HOLD_MS) {
      this.active = null;
      return { token, elapsed: HOLD_MS, dismissed: true };
    }
    return { token, elapsed, dismissed: false };
  }
  cancel(token?: string) {
    if (token === undefined || token === this.active?.token) this.active = null;
  }
}
