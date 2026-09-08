import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunicationRealtimeService } from './communication-realtime.service';
import { ApiConfigService } from '@core/config/api-config.service';
import { TokenService } from '@core/auth/token.service';

/** Socket de mentira con lo justo que toca el servicio. */
function fakeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    connected: false,
    active: true,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => handlers.set(event, cb)),
    onAny: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    /** Dispara un evento como lo haría socket.io. */
    fire: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
  };
}

const io = vi.fn();
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => io(...args) }));

describe('CommunicationRealtimeService', () => {
  let service: CommunicationRealtimeService;
  let token: string | null;

  /** Deja correr el import() dinámico de socket.io-client. */
  const settle = () => new Promise<void>(r => setTimeout(r, 0));

  beforeEach(() => {
    token = 'access-1';
    io.mockReset();
    io.mockImplementation(() => fakeSocket());

    TestBed.configureTestingModule({
      providers: [
        CommunicationRealtimeService,
        { provide: ApiConfigService, useValue: { tenantBase: () => 'https://oficina.example' } },
        { provide: TokenService, useValue: { getAccessToken: () => token } },
      ],
    });
    service = TestBed.inject(CommunicationRealtimeService);
  });

  it('manda el token VIGENTE en cada intento de conexión, no el del primer connect', async () => {
    // El bug original: `auth` era un objeto fijo, así que tras un refresh las reconexiones
    // seguían mandando el token viejo y el server las rechazaba en bucle.
    service.connect();
    await settle();

    const auth = io.mock.calls[0][1].auth as (cb: (d: object) => void) => void;
    const first = vi.fn();
    auth(first);
    expect(first).toHaveBeenCalledWith({ token: 'access-1' });

    token = 'access-2'; // hubo refresh
    const second = vi.fn();
    auth(second);
    expect(second).toHaveBeenCalledWith({ token: 'access-2' });
  });

  it('dos connect() seguidos abren un solo socket', async () => {
    service.connect();
    service.connect();
    await settle();

    expect(io).toHaveBeenCalledTimes(1);
  });

  it('no conecta sin token', async () => {
    token = null;
    service.connect();
    await settle();

    expect(io).not.toHaveBeenCalled();
  });

  it('un disconnect() durante la apertura aborta esa apertura y no deja el servicio trabado', async () => {
    service.connect();
    service.disconnect(); // el módulo de socket.io todavía está bajando
    await settle();

    // Ni siquiera se llega a construir: la generación quedó invalidada.
    expect(io).not.toHaveBeenCalled();
    expect(service.connected()).toBe(false);

    // Y el flag de "apertura en curso" no quedó pegado: se puede volver a conectar.
    service.connect();
    await settle();
    expect(io).toHaveBeenCalledTimes(1);
  });

  it('con un socket vivo, connect() no abre otro', async () => {
    const live = fakeSocket();
    live.connected = true;
    io.mockImplementation(() => live);

    service.connect();
    await settle();
    service.connect();
    await settle();

    expect(io).toHaveBeenCalledTimes(1);
  });

  it('reconstruye un socket muerto en vez de quedarse mudo para siempre', async () => {
    // Antes el guard era solo por existencia: un socket que ya no reintenta dejaba
    // connect() como no-op permanente y la app se quedaba sin tiempo real hasta recargar.
    const dead = fakeSocket();
    dead.connected = false;
    dead.active = false;
    io.mockImplementation(() => dead);

    service.connect();
    await settle();
    service.connect();
    await settle();

    expect(io).toHaveBeenCalledTimes(2);
    expect(dead.removeAllListeners).toHaveBeenCalled();
  });

  it('suelta el socket cuando el server corta la conexión', async () => {
    const socket = fakeSocket();
    io.mockImplementation(() => socket);

    service.connect();
    await settle();
    socket.fire('connect');
    expect(service.connected()).toBe(true);

    socket.fire('disconnect', 'io server disconnect');

    expect(service.connected()).toBe(false);
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
