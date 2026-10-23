import type { Response } from 'express';

/**
 * Writes Server-Sent Events to an Express response. Every `data:` payload is
 * one line of JSON. Writing after the client has gone is a no-op, and a slow
 * client applies backpressure instead of growing a buffer.
 */
export const DRAIN_TIMEOUT_MS = 15_000;

export class SseWriter {
  constructor(
    private readonly response: Response,
    private readonly drainTimeoutMs: number = DRAIN_TIMEOUT_MS,
  ) {}

  get closed(): boolean {
    return this.response.destroyed || this.response.writableEnded;
  }

  /** Sends the headers at once so the client sees the stream open. */
  open(): void {
    const { response } = this;
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    // Tells nginx-style proxies not to buffer the stream.
    response.setHeader('X-Accel-Buffering', 'no');
    response.socket?.setNoDelay(true);
    response.flushHeaders();
  }

  event(name: string, data: unknown): Promise<void> {
    return this.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  comment(text: string): Promise<void> {
    return this.write(`: ${text}\n\n`);
  }

  end(): void {
    if (!this.response.writableEnded && !this.response.destroyed) {
      this.response.end();
    }
  }

  private write(frame: string): Promise<void> {
    const { response } = this;
    if (this.closed) return Promise.resolve();
    if (response.write(frame)) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        response.off('drain', done);
        response.off('close', done);
        resolve();
      };
      // A client that stops reading must not hold the generation forever:
      // give up on it, which closes the response and cancels the reply.
      const timer = setTimeout(() => {
        response.destroy();
        done();
      }, this.drainTimeoutMs);
      response.once('drain', done);
      response.once('close', done);
    });
  }
}
