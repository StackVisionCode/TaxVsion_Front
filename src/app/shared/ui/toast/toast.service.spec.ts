import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('queues a toast with the right kind', () => {
    const svc = new ToastService();
    svc.success('Saved');
    expect(svc.toasts()).toHaveLength(1);
    expect(svc.toasts()[0]).toMatchObject({ kind: 'success', message: 'Saved' });
  });

  it('dismiss marks the toast leaving first, then removes it after the exit delay', () => {
    const svc = new ToastService();
    svc.info('Working');
    const id = svc.toasts()[0].id;

    svc.dismiss(id);
    // Sigue montado durante la salida, marcado `leaving` (el host reproduce el keyframe).
    expect(svc.toasts()).toHaveLength(1);
    expect(svc.toasts()[0].leaving).toBe(true);

    vi.advanceTimersByTime(200);
    expect(svc.toasts()).toHaveLength(0);
  });

  it('auto-dismisses after its lifetime through the same leaving path', () => {
    const svc = new ToastService();
    svc.error('Oops');

    vi.advanceTimersByTime(3200); // vida del toast → arranca la salida
    expect(svc.toasts()[0]?.leaving).toBe(true);

    vi.advanceTimersByTime(200); // fin de la salida → se retira
    expect(svc.toasts()).toHaveLength(0);
  });

  it('a second dismiss on an already-leaving toast removes it immediately', () => {
    const svc = new ToastService();
    svc.success('Done');
    const id = svc.toasts()[0].id;

    svc.dismiss(id); // marca leaving
    svc.dismiss(id); // ya saliendo → retiro inmediato
    expect(svc.toasts()).toHaveLength(0);
  });
});
