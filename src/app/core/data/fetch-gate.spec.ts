import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchGate } from './fetch-gate';

describe('FetchGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('deja pasar la primera carga y bloquea la siguiente dentro del TTL', () => {
    const gate = new FetchGate(60_000);

    expect(gate.shouldFetch()).toBe(true);
    gate.settle(true);

    // Este es el caso que motiva la clase: el componente se re-monta y volvía a pedir todo.
    expect(gate.shouldFetch()).toBe(false);
  });

  it('vuelve a pedir cuando venció el TTL', () => {
    const gate = new FetchGate(60_000);
    gate.shouldFetch();
    gate.settle(true);

    vi.advanceTimersByTime(60_001);
    expect(gate.shouldFetch()).toBe(true);
  });

  it('siempre va al backend si cambia la clave del recurso', () => {
    const gate = new FetchGate(60_000);
    gate.shouldFetch('cliente-1');
    gate.settle(true);

    expect(gate.shouldFetch('cliente-2')).toBe(true);
  });

  it('un fallo no marca los datos como frescos: el siguiente intento reintenta', () => {
    const gate = new FetchGate(60_000);
    gate.shouldFetch();
    gate.settle(false);

    expect(gate.shouldFetch()).toBe(true);
  });

  it('no duplica una petición ya en vuelo', () => {
    const gate = new FetchGate(60_000);

    expect(gate.shouldFetch()).toBe(true);
    expect(gate.shouldFetch()).toBe(false);
  });

  it('force salta la caché aunque esté fresca', () => {
    const gate = new FetchGate(60_000);
    gate.shouldFetch();
    gate.settle(true);

    expect(gate.shouldFetch(null, true)).toBe(true);
  });

  it('invalidate obliga a recargar en el próximo intento', () => {
    const gate = new FetchGate(60_000);
    gate.shouldFetch();
    gate.settle(true);

    gate.invalidate();
    expect(gate.shouldFetch()).toBe(true);
  });
});
