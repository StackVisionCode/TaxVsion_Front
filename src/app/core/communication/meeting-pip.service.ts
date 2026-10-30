import { Injectable, computed, inject, signal } from '@angular/core';
import { MeetingSessionState } from './meeting-session-state';

/** Modo de PiP disponible en este navegador. */
export type MeetingPipMode = 'document' | 'video' | 'none';

/** Clave de la preferencia "pop out automático al ocultar la pestaña" (`localStorage`). */
export const AUTO_PIP_KEY = 'tvf.meeting.autoPip';

/** Tamaño de la ventana Document PiP (coincide con el panel del mini-player: 22rem de ancho). */
const PIP_WINDOW_SIZE = { width: 360, height: 420 };

interface DocumentPictureInPictureLike {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

type MediaSessionAction = 'togglemicrophone' | 'togglecamera' | 'hangup';

/** Acciones de la sesión de media que el navegador puede mostrar en su propio PiP de video. */
export interface MeetingPipHandlers {
  toggleMicrophone?: () => void;
  toggleCamera?: () => void;
  hangup?: () => void;
}

/**
 * Detección de capacidad (D-43), pura para los specs:
 * - `documentPictureInPicture` (Chrome/Edge) → se MUEVE el panel del mini-player a una ventana propia;
 * - si no, `HTMLVideoElement.requestPictureInPicture` → PiP del video principal + `MediaSession`;
 * - sin nada → 'none' (sin botón).
 */
export function detectPipMode(win: Partial<Window> & { documentPictureInPicture?: unknown } = globalThis as never, doc: Partial<Document> = typeof document !== 'undefined' ? document : {}): MeetingPipMode {
  if (win.documentPictureInPicture && typeof (win.documentPictureInPicture as DocumentPictureInPictureLike).requestWindow === 'function') {
    return 'document';
  }
  const videoProto = (win as { HTMLVideoElement?: { prototype?: object } }).HTMLVideoElement?.prototype;
  if (videoProto && 'requestPictureInPicture' in videoProto && doc.pictureInPictureEnabled !== false) {
    return 'video';
  }
  return 'none';
}

/**
 * F5 (T-55, D-43) — Picture-in-Picture progresivo del meeting.
 *
 * - `supported()`: hay algún modo; sin soporte la UI no muestra "Pop out".
 * - `toggle()`: desde un gesto del usuario. Con Document PiP, el mini-player se MONTA (`requested`)
 *   aunque la sala esté abierta, registra su panel (`registerPanel`) y éste se mueve a la ventana PiP con
 *   las hojas de estilo copiadas; `pagehide` de esa ventana lo devuelve a su sitio. Los `<audio>` remotos
 *   NO se mueven: el mini-player los renderiza fuera del panel, en la ventana principal.
 * - Fallback: `requestPictureInPicture()` del `<video>` principal (`registerMainVideo`) con
 *   `MediaSession.setActionHandler` para micrófono/cámara/colgar donde exista.
 * - Auto-PiP al ocultar la pestaña SOLO si el usuario lo pidió (`autoPipEnabled`, en `localStorage`:
 *   el backend no expone todavía el campo en `PUT /preferences`).
 */
@Injectable({ providedIn: 'root' })
export class MeetingPipService {
  private readonly session = inject(MeetingSessionState);

  readonly mode = signal<MeetingPipMode>(detectPipMode());
  readonly supported = computed(() => this.mode() !== 'none');
  /** El mini-player debe montarse (también con la sala abierta) porque va a salir a la ventana PiP. */
  readonly requested = signal(false);
  /** Hay una ventana/overlay PiP abierto. */
  readonly active = signal(false);
  readonly autoPipEnabled = signal(readAutoPip());

  private panel: HTMLElement | null = null;
  private placeholder: Comment | null = null;
  private pipWindow: Window | null = null;
  private headObserver: MutationObserver | null = null;
  private resolveMainVideo: () => HTMLVideoElement | null = () => null;
  private handlers: MeetingPipHandlers = {};
  private opening = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.autoPipEnabled() && this.session.phase() === 'joined' && !this.active()) {
          void this.open(); // best-effort: sin activación reciente el navegador puede negarlo
        }
      });
    }
  }

  setAutoPip(enabled: boolean): void {
    this.autoPipEnabled.set(enabled);
    try {
      localStorage.setItem(AUTO_PIP_KEY, enabled ? '1' : '0');
    } catch {
      /* sin storage */
    }
  }

  /** El mini-player registra su panel (null al desmontarse). Si había un pop-out pendiente, se abre ya. */
  registerPanel(panel: HTMLElement | null): void {
    if (this.panel && this.panel !== panel && this.active() && this.mode() === 'document') {
      this.close();
    }
    this.panel = panel;
    if (panel && this.requested() && !this.active() && this.mode() === 'document') {
      void this.open();
    }
  }

  /** Cómo encontrar el `<video>` principal para el fallback de PiP de video (+ acciones de MediaSession). */
  registerMainVideo(resolve: () => HTMLVideoElement | null, handlers: MeetingPipHandlers = {}): void {
    this.resolveMainVideo = resolve;
    this.handlers = handlers;
  }

  async toggle(): Promise<void> {
    if (this.active()) {
      this.close();
    } else {
      await this.open();
    }
  }

  /** Abre el PiP del modo disponible. Devuelve true si quedó abierto. */
  async open(): Promise<boolean> {
    if (this.opening || this.active()) {
      return this.active();
    }
    this.opening = true;
    try {
      switch (this.mode()) {
        case 'document':
          return await this.openDocumentPip();
        case 'video':
          return await this.openVideoPip();
        default:
          return false;
      }
    } finally {
      this.opening = false;
    }
  }

  close(): void {
    this.requested.set(false);
    if (this.pipWindow) {
      const win = this.pipWindow;
      this.pipWindow = null;
      this.restorePanel();
      try {
        win.close();
      } catch {
        /* ya cerrada */
      }
    }
    if (this.mode() === 'video' && typeof document !== 'undefined' && document.pictureInPictureElement) {
      void document.exitPictureInPicture?.().catch(() => undefined);
    }
    this.active.set(false);
  }

  // ---------- Document PiP: mover el panel ----------

  private async openDocumentPip(): Promise<boolean> {
    this.requested.set(true);
    const panel = this.panel;
    if (!panel) {
      return false; // el mini-player se está montando: `registerPanel` vuelve a llamar a open()
    }
    const api = (window as unknown as { documentPictureInPicture?: DocumentPictureInPictureLike }).documentPictureInPicture;
    if (!api) {
      this.requested.set(false);
      return false;
    }
    let win: Window;
    try {
      win = await api.requestWindow(PIP_WINDOW_SIZE);
    } catch {
      this.requested.set(false); // sin activación del usuario / bloqueado
      return false;
    }
    this.pipWindow = win;
    copyStyleSheets(document, win.document);
    this.watchNewStyles(win.document);
    this.placeholder = document.createComment('meeting-mini-player');
    panel.parentNode?.insertBefore(this.placeholder, panel);
    win.document.body.append(panel);
    resumeVideos(panel);
    win.addEventListener('pagehide', () => this.onPipWindowClosed(win), { once: true });
    this.active.set(true);
    return true;
  }

  private onPipWindowClosed(win: Window): void {
    if (this.pipWindow !== win) {
      return;
    }
    this.pipWindow = null;
    this.restorePanel();
    this.active.set(false);
    this.requested.set(false);
  }

  /** Devuelve el panel a su sitio en la ventana principal (si sigue montado). */
  private restorePanel(): void {
    this.headObserver?.disconnect();
    this.headObserver = null;
    const panel = this.panel;
    const placeholder = this.placeholder;
    this.placeholder = null;
    if (panel && placeholder?.parentNode) {
      placeholder.parentNode.replaceChild(panel, placeholder);
      resumeVideos(panel);
    } else {
      placeholder?.remove();
    }
  }

  /** Estilos de componentes que se carguen DESPUÉS (chunks diferidos) también van a la ventana PiP. */
  private watchNewStyles(target: Document): void {
    if (typeof MutationObserver === 'undefined') {
      return;
    }
    this.headObserver = new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes.forEach(node => {
          if (node instanceof HTMLStyleElement || (node instanceof HTMLLinkElement && node.rel === 'stylesheet')) {
            target.head.append(node.cloneNode(true));
          }
        });
      }
    });
    this.headObserver.observe(document.head, { childList: true });
  }

  // ---------- Fallback: PiP de video + MediaSession ----------

  private async openVideoPip(): Promise<boolean> {
    const video = this.resolveMainVideo();
    if (!video || !video.srcObject) {
      return false;
    }
    try {
      await video.requestPictureInPicture();
    } catch {
      return false;
    }
    video.addEventListener('leavepictureinpicture', () => this.active.set(false), { once: true });
    this.bindMediaSession();
    this.active.set(true);
    return true;
  }

  private bindMediaSession(): void {
    const mediaSession = (navigator as Navigator & { mediaSession?: { setActionHandler(action: string, handler: (() => void) | null): void } }).mediaSession;
    if (!mediaSession) {
      return;
    }
    const bind = (action: MediaSessionAction, handler: (() => void) | undefined) => {
      try {
        mediaSession.setActionHandler(action, handler ?? null); // acciones no soportadas lanzan: se ignoran
      } catch {
        /* no soportada en este navegador */
      }
    };
    bind('togglemicrophone', this.handlers.toggleMicrophone);
    bind('togglecamera', this.handlers.toggleCamera);
    bind('hangup', this.handlers.hangup);
  }
}

/** Copia hojas de estilo (inline y enlazadas) de un documento a otro. */
export function copyStyleSheets(from: Document, to: Document): void {
  for (const sheet of Array.from(from.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map(rule => rule.cssText)
        .join('');
      const style = to.createElement('style');
      style.textContent = css;
      to.head.append(style);
    } catch {
      if (sheet.href) {
        const link = to.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        to.head.append(link);
      }
    }
  }
}

/** Un `<video>` adoptado por otro documento puede quedar pausado: se reanuda. */
function resumeVideos(root: HTMLElement): void {
  root.querySelectorAll('video').forEach(video => void video.play?.()?.catch?.(() => undefined));
}

function readAutoPip(): boolean {
  try {
    return localStorage.getItem(AUTO_PIP_KEY) === '1';
  } catch {
    return false;
  }
}
