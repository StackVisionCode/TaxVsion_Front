import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionExpiryService } from './session-expiry.service';
import { TokenService } from '../auth/token.service';

/** TokenService de mentira: solo lo que mira SessionExpiryService. */
class FakeTokenService {
  token: string | null = 'access-1';
  remaining = 900;
  getAccessToken(): string | null {
    return this.token;
  }
  getAccessTokenRemainingSeconds(): number {
    return this.remaining;
  }
}

/** Fuerza `document.visibilityState`, que es de solo lectura. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

describe('SessionExpiryService', () => {
  let tokens: FakeTokenService;
  let service: SessionExpiryService;

  const build = () => {
    TestBed.configureTestingModule({
      providers: [SessionExpiryService, { provide: TokenService, useValue: tokens }],
    });
    return TestBed.inject(SessionExpiryService);
  };

  /** Envejece el reloj de inactividad sin tocar el reloj del token. */
  const idleFor = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
    tokens = new FakeTokenService();
    service = build();
  });

  afterEach(() => {
    service.ngOnDestroy();
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('un access token vencido NO cierra la sesión: pide refresh', () => {
    // Este era el bug: al volver de otra pestaña con el token ya vencido se caía directo al
    // login. El access token vencido se resuelve con el refresh token, no cerrando sesión.
    const expired = vi.fn();
    const extended = vi.fn();
    service.sessionExpired$.subscribe(expired);
    service.sessionExtended$.subscribe(extended);

    tokens.remaining = 0;
    vi.advanceTimersByTime(10_000);

    expect(expired).not.toHaveBeenCalled();
    expect(extended).toHaveBeenCalledTimes(1);
  });

  it('refresca en silencio cuando al token le queda poco y el usuario está activo', () => {
    const extended = vi.fn();
    service.sessionExtended$.subscribe(extended);

    tokens.remaining = 60;
    vi.advanceTimersByTime(10_000);

    expect(extended).toHaveBeenCalledTimes(1);
  });

  it('no dispara un segundo refresh mientras hay uno en vuelo', () => {
    const extended = vi.fn();
    service.sessionExtended$.subscribe(extended);

    tokens.remaining = 60;
    vi.advanceTimersByTime(30_000); // tres pasadas del intervalo

    expect(extended).toHaveBeenCalledTimes(1);
  });

  it('muestra el aviso tras superar la inactividad', () => {
    const states: boolean[] = [];
    service.expiryState$.subscribe(s => states.push(s.show));

    idleFor(15 * 60 * 1000);
    vi.advanceTimersByTime(10_000);

    expect(states.at(-1)).toBe(true);
  });

  it('con la pestaña oculta NO abre el aviso, y lo abre al volver el foco', () => {
    const states: boolean[] = [];
    service.expiryState$.subscribe(s => states.push(s.show));

    setVisibility('hidden');
    idleFor(15 * 60 * 1000);
    vi.advanceTimersByTime(10_000);
    // Si se abriera acá, su countdown de 60s correría estrangulado y el usuario se
    // encontraría el modal vencido al volver.
    expect(states.at(-1)).toBe(false);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(states.at(-1)).toBe(true);
  });

  it('sin token (logout ya hecho) cierra el aviso abierto y no vuelve a avisar', () => {
    const states: boolean[] = [];
    const expired = vi.fn();
    service.expiryState$.subscribe(s => states.push(s.show));
    service.sessionExpired$.subscribe(expired);

    idleFor(15 * 60 * 1000);
    vi.advanceTimersByTime(10_000);
    expect(states.at(-1)).toBe(true);

    // Otra pestaña cerró la sesión: el modal se retira solo, sin emitir un logout de más.
    tokens.token = null;
    vi.advanceTimersByTime(10_000);

    expect(states.at(-1)).toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it('el countdown del aviso termina cerrando la sesión', () => {
    const expired = vi.fn();
    service.sessionExpired$.subscribe(expired);

    idleFor(15 * 60 * 1000);
    vi.advanceTimersByTime(10_000); // abre el aviso
    vi.advanceTimersByTime(60_000); // agota los 60s

    expect(expired).toHaveBeenCalledTimes(1);
  });
});
