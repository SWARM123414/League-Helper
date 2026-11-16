// EventEmitter mínimo (substitui o 'events' do Node).
type Listener = (...args: any[]) => void;

export class Emitter {
  private listeners: Map<string, Listener[]> = new Map();

  on(event: string, fn: Listener): this {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    const list = this.listeners.get(event);
    if (!list || !list.length) return false;
    for (const fn of [...list]) fn(...args);
    return true;
  }
}
