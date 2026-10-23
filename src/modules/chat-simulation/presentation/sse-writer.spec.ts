import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { SseWriter } from './sse-writer';

class StalledResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  write(): boolean {
    return false; // never drains
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

describe('SseWriter', () => {
  it('gives up on a client that never drains and destroys the response', async () => {
    const response = new StalledResponse();
    const writer = new SseWriter(response as unknown as Response, 20);

    await writer.event('reply.delta', { text: 'x' });

    expect(response.destroyed).toBe(true);
    expect(writer.closed).toBe(true);
  });
});
