import { deletionBackoffMs } from './remote-session-deletion-queue';

describe('deletionBackoffMs', () => {
  it('doubles from 30 seconds and is capped at one hour', () => {
    expect(deletionBackoffMs(1)).toBe(30_000);
    expect(deletionBackoffMs(2)).toBe(60_000);
    expect(deletionBackoffMs(3)).toBe(120_000);
    expect(deletionBackoffMs(50)).toBe(3_600_000);
  });
});
