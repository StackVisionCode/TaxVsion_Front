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

  // Varios widgets fallando a la vez apilaban un toast idéntico por fallo.
  it('does not stack identical toasts: the visible one just lives longer', () => {
    const svc = new ToastService();
    svc.error('Something went wrong. Please try again.');
    vi.advanceTimersByTime(3000);
    svc.error('Something went wrong. Please try again.');

    expect(svc.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(3000); // la vida se reinició con el segundo
    expect(svc.toasts()[0].leaving).toBeFalsy();
  });

  it('countdown shows a single keyed toast that counts down and closes at zero', () => {
    const svc = new ToastService();
    svc.countdown('throttle', 'info', 3, s => `Try again in ${s}s`);

    expect(svc.toasts()).toHaveLength(1);
    expect(svc.toasts()[0]).toMatchObject({ key: 'throttle', message: 'Try again in 3s' });

    vi.advanceTimersByTime(1000);
    expect(svc.toasts()[0].message).toBe('Try again in 2s');

    vi.advanceTimersByTime(2000); // llega a 0 → sale
    vi.advanceTimersByTime(200);
    expect(svc.toasts()).toHaveLength(0);
  });

  it('a second countdown with the same key extends the wait instead of stacking', () => {
    const svc = new ToastService();
    svc.countdown('throttle', 'info', 2, s => `${s}`);
    svc.countdown('throttle', 'info', 10, s => `${s}`);

    expect(svc.toasts()).toHaveLength(1);
    expect(svc.toasts()[0].message).toBe('10');
  });

  it('while a countdown is visible, screen toasts saying the same thing are absorbed', () => {
    const svc = new ToastService();
    svc.error('Too fast.'); // ya estaba en pantalla antes del aviso
    svc.countdown('throttle', 'info', 30, s => `Too fast. Wait ${s}s`, ['Too fast.']);

    svc.error('Too fast.'); // lo que levanta la pantalla después del mismo 429
    svc.error('Other error');

    vi.advanceTimersByTime(200); // termina la salida del toast reemplazado
    expect(svc.toasts().map(t => t.message)).toEqual(['Too fast. Wait 30s', 'Other error']);
  });

  it('dismissing a countdown by hand stops its ticking', () => {
    const svc = new ToastService();
    svc.countdown('throttle', 'info', 30, s => `${s}`, ['x']);

    svc.dismiss(svc.toasts()[0].id);
    vi.advanceTimersByTime(5000);
    svc.error('x'); // ya no hay aviso activo que lo absorba

    expect(svc.toasts().map(t => t.message)).toEqual(['x']);
  });
});
