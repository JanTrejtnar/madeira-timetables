// The page's side of the planner's search worker (searchWorker.ts). Without Web Workers (old browser, tests) `search` rejects and the caller searches on the page's thread.
import type { Line } from '../types';
import type { Ymd } from './holidays';
import type { Picked } from './plannerForm';
import type { WireResult } from './searchWire';

/** one question to the planner; `lineIds`: the lines the type / operator filter lets through (null = all) */
export interface SearchJob {
  date: Ymd;
  school: boolean;
  municipalities: string[];
  lineIds: number[] | null;
  from: Picked;
  to: Picked;
  at: number;
  directOnly: boolean;
}

export type WorkerRequest =
  | { type: 'init'; lines: Line[]; terminalWalks?: { a: string; b: string; min: number }[] }
  | { type: 'search'; id: number; job: SearchJob };
export type WorkerReply = { id: number; result: WireResult | null } | { id: number; error: string };

const READY_TIMEOUT_MS = 20_000;

export class SearchClient {
  private worker: Worker | null = null;
  private seq = 0;
  private ready = false;
  private waiting = new Map<number, { resolve: (r: WireResult | null) => void; reject: (e: Error) => void }>();

  constructor(lines: Line[], terminalWalks?: { a: string; b: string; min: number }[]) {
    if (typeof Worker === 'undefined') return;
    try {
      const w = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerReply>) => {
        if (e.data.id === 0) {
          this.ready = true;
          return;
        }
        const p = this.waiting.get(e.data.id);
        if (!p) return;
        this.waiting.delete(e.data.id);
        if ('error' in e.data) p.reject(new Error(e.data.error));
        else p.resolve(e.data.result);
      };
      w.onerror = () => this.fail();
      w.onmessageerror = () => this.fail();
      w.postMessage({ type: 'init', lines, terminalWalks } satisfies WorkerRequest);
      this.worker = w;
      // a worker that never starts (blocked script, no error event) must not leave the search waiting for ever: after this long the page searches itself
      setTimeout(() => !this.ready && this.fail(), READY_TIMEOUT_MS);
    } catch {
      this.worker = null;
    }
  }

  /** the worker is gone (it failed to start or crashed): everything waiting is told, later searches reject at once */
  private fail() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.waiting.values()) p.reject(new Error('search worker failed'));
    this.waiting.clear();
  }

  search(job: SearchJob): Promise<WireResult | null> {
    const w = this.worker;
    if (!w) return Promise.reject(new Error('no search worker'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      w.postMessage({ type: 'search', id, job } satisfies WorkerRequest);
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.waiting.values()) p.reject(new Error('search worker closed'));
    this.waiting.clear();
  }
}
