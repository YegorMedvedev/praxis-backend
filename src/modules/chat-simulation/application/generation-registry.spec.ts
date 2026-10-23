import { GenerationRegistry } from './generation-registry';

describe('GenerationRegistry', () => {
  it('grants one claim per session at a time', () => {
    const registry = new GenerationRegistry();

    const first = registry.tryAcquire('s1');

    expect(first).not.toBeNull();
    expect(registry.tryAcquire('s1')).toBeNull();
    expect(registry.tryAcquire('s2')).not.toBeNull();
    first?.release();
    expect(registry.tryAcquire('s1')).not.toBeNull();
  });

  it('cancel aborts the signal but keeps the claim until released', () => {
    const registry = new GenerationRegistry();
    const claim = registry.tryAcquire('s1')!;

    registry.cancel('s1');

    expect(claim.signal.aborted).toBe(true);
    expect(registry.isActive('s1')).toBe(true);
    claim.release();
    expect(registry.isActive('s1')).toBe(false);
  });

  it('cancel and a stale release never touch a newer claim', () => {
    const registry = new GenerationRegistry();
    const old = registry.tryAcquire('s1')!;
    old.release();
    const fresh = registry.tryAcquire('s1')!;

    old.release();
    registry.cancel('nope');

    expect(registry.isActive('s1')).toBe(true);
    expect(fresh.signal.aborted).toBe(false);
  });

  it('finish frees the slot without aborting; a later release is a no-op', () => {
    const registry = new GenerationRegistry();
    const claim = registry.tryAcquire('s1')!;

    claim.finish();
    claim.release();

    expect(claim.signal.aborted).toBe(false);
    expect(registry.isActive('s1')).toBe(false);
  });
});
