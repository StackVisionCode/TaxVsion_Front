import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { runWithLaunch, type LaunchPhase } from './launch.util';

describe('runWithLaunch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('éxito: working con mínimo garantizado → done → idle, y devuelve el resultado', async () => {
    const phase = signal<LaunchPhase>('idle');
    const run = runWithLaunch(phase, async () => 'ok', { minWorkingMs: 1000, doneMs: 500 });

    expect(phase()).toBe('working');
    await vi.advanceTimersByTimeAsync(999);
    expect(phase()).toBe('working');
    await vi.advanceTimersByTimeAsync(1);
    expect(phase()).toBe('done');
    await vi.advanceTimersByTimeAsync(500);

    await expect(run).resolves.toBe('ok');
    expect(phase()).toBe('idle');
  });

  it('onDone corre al aparecer el sello, antes de terminar la coreografía', async () => {
    const phase = signal<LaunchPhase>('idle');
    const seen: string[] = [];
    const run = runWithLaunch(phase, async () => 'ok', {
      minWorkingMs: 0,
      doneMs: 500,
      onDone: result => seen.push(`${result}:${phase()}`),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['ok:done']);
    await vi.advanceTimersByTimeAsync(500);
    await run;
    expect(phase()).toBe('idle');
  });

  it('keepOnDone deja la fase en done para navegar con la pantalla cubierta', async () => {
    const phase = signal<LaunchPhase>('idle');
    const run = runWithLaunch(phase, async () => 'id-1', { minWorkingMs: 0, doneMs: 300, keepOnDone: true });

    await vi.advanceTimersByTimeAsync(300);

    await expect(run).resolves.toBe('id-1');
    expect(phase()).toBe('done');
  });

  it('un resultado falsy corta al instante y sin sello', async () => {
    const phase = signal<LaunchPhase>('idle');

    const result = await runWithLaunch(phase, async () => false);

    expect(result).toBe(false);
    expect(phase()).toBe('idle');
  });

  it('una excepción vuelve a idle y se propaga', async () => {
    const phase = signal<LaunchPhase>('idle');

    await expect(
      runWithLaunch(phase, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(phase()).toBe('idle');
  });
});
