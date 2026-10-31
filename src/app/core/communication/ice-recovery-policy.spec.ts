import { describe, expect, it } from 'vitest';
import { DEFAULT_ICE_RECOVERY_POLICY, aggregateMediaState, decideIceRecovery, restartDelayMs } from './ice-recovery-policy';

describe('ice-recovery-policy', () => {
  it('reinicia ya en failed y espera la gracia en disconnected', () => {
    expect(decideIceRecovery('failed', 0)).toBe('restart-now');
    expect(decideIceRecovery('disconnected', 0)).toBe('restart-after-grace');
  });

  it('se rinde al agotar los reintentos', () => {
    const max = DEFAULT_ICE_RECOVERY_POLICY.maxRestarts;
    expect(decideIceRecovery('failed', max)).toBe('give-up');
    expect(decideIceRecovery('disconnected', max)).toBe('give-up');
  });

  it('connected/completed recuperan y los demás estados no hacen nada', () => {
    expect(decideIceRecovery('connected', 2)).toBe('recovered');
    expect(decideIceRecovery('completed', 2)).toBe('recovered');
    expect(decideIceRecovery('checking', 0)).toBe('none');
    expect(decideIceRecovery('closed', 0)).toBe('none');
  });

  it('el retardo crece ×2 por intento', () => {
    expect(restartDelayMs(0)).toBe(1000);
    expect(restartDelayMs(1)).toBe(2000);
    expect(restartDelayMs(2)).toBe(4000);
  });

  it('agrega varios enlaces: failed manda sobre reconnecting y ok', () => {
    expect(aggregateMediaState([])).toBe('ok');
    expect(aggregateMediaState(['ok', 'reconnecting'])).toBe('reconnecting');
    expect(aggregateMediaState(['reconnecting', 'failed', 'ok'])).toBe('failed');
  });
});
