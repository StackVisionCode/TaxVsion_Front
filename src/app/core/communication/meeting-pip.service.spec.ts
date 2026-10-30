import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_PIP_KEY, MeetingPipService, copyStyleSheets, detectPipMode } from './meeting-pip.service';
import { MeetingSessionState } from './meeting-session-state';

/** Ventana PiP falsa: un documento propio donde se mueve el panel. */
function fakePipWindow() {
  const doc = document.implementation.createHTMLDocument('pip');
  const listeners = new Map<string, () => void>();
  const win = {
    document: doc,
    addEventListener: (event: string, handler: () => void) => listeners.set(event, handler),
    close: vi.fn(() => listeners.get('pagehide')?.()),
    fire: (event: string) => listeners.get('pagehide' === event ? 'pagehide' : event)?.(),
  };
  return win;
}

describe('detectPipMode (D-43, feature detection)', () => {
  it('documentPictureInPicture → document; solo requestPictureInPicture → video; nada → none', () => {
    expect(detectPipMode({ documentPictureInPicture: { requestWindow: () => Promise.resolve({} as Window) } }, {})).toBe('document');
    expect(detectPipMode({ HTMLVideoElement: { prototype: { requestPictureInPicture() {} } } } as never, { pictureInPictureEnabled: true })).toBe('video');
    expect(detectPipMode({ HTMLVideoElement: { prototype: { requestPictureInPicture() {} } } } as never, { pictureInPictureEnabled: false })).toBe('none');
    expect(detectPipMode({ HTMLVideoElement: { prototype: {} } } as never, {})).toBe('none');
  });
});

describe('MeetingPipService', () => {
  let service: MeetingPipService;
  let pipWin: ReturnType<typeof fakePipWindow>;
  let requestWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.removeItem(AUTO_PIP_KEY);
    pipWin = fakePipWindow();
    requestWindow = vi.fn(() => Promise.resolve(pipWin as unknown as Window));
    (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture = { requestWindow };
    TestBed.configureTestingModule({});
    service = TestBed.inject(MeetingPipService);
  });

  afterEach(() => {
    delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    TestBed.resetTestingModule();
  });

  it('con Document PiP mueve el panel a la ventana PiP y lo devuelve en pagehide', async () => {
    const host = document.createElement('div');
    const panel = document.createElement('section');
    panel.innerHTML = '<video></video>';
    host.append(panel);
    document.body.append(host);

    expect(service.mode()).toBe('document');
    service.registerPanel(panel);
    expect(await service.open()).toBe(true);
    expect(requestWindow).toHaveBeenCalledWith({ width: 360, height: 420 });
    expect(service.active()).toBe(true);
    expect(service.requested()).toBe(true);
    expect(panel.ownerDocument).toBe(pipWin.document);
    expect(pipWin.document.body.contains(panel)).toBe(true);
    expect(host.contains(panel)).toBe(false);

    pipWin.fire('pagehide');
    expect(service.active()).toBe(false);
    expect(service.requested()).toBe(false);
    expect(host.contains(panel)).toBe(true);
    host.remove();
  });

  it('"Pop out" sin panel montado queda pedido y se abre cuando el mini-player registra su panel', async () => {
    expect(await service.open()).toBe(false);
    expect(service.requested()).toBe(true); // el shell monta el mini-player aunque la sala esté abierta

    const panel = document.createElement('section');
    document.body.append(panel);
    service.registerPanel(panel);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.active()).toBe(true);
    service.close();
    expect(service.active()).toBe(false);
    expect(pipWin.close).toHaveBeenCalled();
    panel.remove();
  });

  it('si el navegador rechaza la ventana (sin gesto) no queda nada pedido', async () => {
    requestWindow.mockImplementation(() => Promise.reject(new Error('NotAllowed')));
    const panel = document.createElement('section');
    document.body.append(panel);
    service.registerPanel(panel);
    expect(await service.open()).toBe(false);
    expect(service.requested()).toBe(false);
    expect(service.active()).toBe(false);
    panel.remove();
  });

  it('la preferencia de auto-PiP vive en localStorage y solo dispara si estoy dentro de la reunión', async () => {
    expect(service.autoPipEnabled()).toBe(false);
    service.setAutoPip(true);
    expect(localStorage.getItem(AUTO_PIP_KEY)).toBe('1');
    const panel = document.createElement('section');
    document.body.append(panel);
    service.registerPanel(panel);

    // Sin meeting (phase idle) ocultar la pestaña no abre nada.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(requestWindow).not.toHaveBeenCalled();

    TestBed.inject(MeetingSessionState).phase.set('joined');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(requestWindow).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    panel.remove();
  });

  it('sin Document PiP usa el PiP de video del tile principal y enlaza MediaSession', async () => {
    delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    TestBed.resetTestingModule();
    const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
    const hadPip = 'requestPictureInPicture' in proto;
    proto['requestPictureInPicture'] = vi.fn(() => Promise.resolve({}));
    const setActionHandler = vi.fn((action: string) => {
      if (action === 'togglecamera') throw new TypeError('unsupported'); // como hace Safari
    });
    Object.defineProperty(navigator, 'mediaSession', { value: { setActionHandler }, configurable: true });
    try {
      TestBed.configureTestingModule({});
      const videoPip = TestBed.inject(MeetingPipService);
      expect(videoPip.mode()).toBe('video');
      const video = document.createElement('video');
      Object.defineProperty(video, 'srcObject', { value: {}, configurable: true });
      const hangup = vi.fn();
      videoPip.registerMainVideo(() => video, { hangup });
      expect(await videoPip.open()).toBe(true);
      expect(videoPip.active()).toBe(true);
      expect(setActionHandler).toHaveBeenCalledWith('hangup', hangup);
      expect(setActionHandler).toHaveBeenCalledWith('togglecamera', null); // el throw no rompe
      video.dispatchEvent(new Event('leavepictureinpicture'));
      expect(videoPip.active()).toBe(false);
    } finally {
      if (!hadPip) {
        delete proto['requestPictureInPicture'];
      }
      delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
    }
  });

  it('copyStyleSheets copia hojas inline y enlaza las que no se pueden leer (CORS)', () => {
    const from = {
      styleSheets: [
        { cssRules: [{ cssText: '.a{color:red}' }], href: null },
        {
          href: 'https://cdn.example/x.css',
          get cssRules(): CSSRuleList {
            throw new DOMException('blocked', 'SecurityError');
          },
        },
      ],
    } as unknown as Document;
    const to = document.implementation.createHTMLDocument('to');
    copyStyleSheets(from, to);
    expect(to.head.querySelector('style')?.textContent).toBe('.a{color:red}');
    expect(to.head.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('https://cdn.example/x.css');
  });
});
