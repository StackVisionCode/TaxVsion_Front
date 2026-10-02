import { TestBed } from '@angular/core/testing';
import { ClipboardService } from './clipboard.service';

describe('ClipboardService', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalExec = document.execCommand;

  function setClipboard(value: unknown): void {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  }

  afterEach(() => {
    if (original) {
      Object.defineProperty(navigator, 'clipboard', original);
    } else {
      delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    }
    document.execCommand = originalExec;
  });

  it('usa navigator.clipboard cuando existe', async () => {
    const written: string[] = [];
    setClipboard({ writeText: async (t: string) => void written.push(t) });
    const ok = await TestBed.inject(ClipboardService).copy('hello');
    expect(ok).toBe(true);
    expect(written).toEqual(['hello']);
  });

  it('cae al textarea si la API falla', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('denied')) });
    const calls: string[] = [];
    document.execCommand = ((cmd: string) => {
      calls.push(cmd);
      return true;
    }) as typeof document.execCommand;
    const ok = await TestBed.inject(ClipboardService).copy('x');
    expect(ok).toBe(true);
    expect(calls).toEqual(['copy']);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('devuelve false si nada funciona', async () => {
    setClipboard(undefined);
    document.execCommand = (() => false) as typeof document.execCommand;
    expect(await TestBed.inject(ClipboardService).copy('x')).toBe(false);
  });
});
