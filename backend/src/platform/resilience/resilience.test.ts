import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError, TimeoutError, withTimeout } from './resilience.js';

describe('resilience', () => {
  it('times out slow work', async () => {
    const slow = new Promise((r) => setTimeout(r, 200));
    await expect(withTimeout(slow, 20, 'supplier')).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(Promise.resolve(1), 20, 'supplier')).resolves.toBe(1);
  });

  it('opens after repeated failures, then allows one trial after the cool-down', async () => {
    let t = 0;
    const b = new CircuitBreaker('s', { failureThreshold: 2, openMs: 1000, now: () => t });
    const fail = () => Promise.reject(new Error('boom'));
    await expect(b.run(fail)).rejects.toThrow('boom');
    await expect(b.run(fail)).rejects.toThrow('boom');
    expect(b.current).toBe('open');
    await expect(b.run(() => Promise.resolve(1))).rejects.toBeInstanceOf(CircuitOpenError);
    t = 1000;
    expect(b.current).toBe('half_open');
    await expect(b.run(fail)).rejects.toThrow('boom'); // failed trial re-opens
    expect(b.current).toBe('open');
    t = 2000;
    await expect(b.run(() => Promise.resolve(2))).resolves.toBe(2);
    expect(b.current).toBe('closed');
  });
});
