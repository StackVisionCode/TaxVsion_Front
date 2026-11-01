import { DestroyRef, Directive, ElementRef, computed, inject, signal } from '@angular/core';

/** Tras este tiempo sin mover el puntero en pantalla completa se ocultan los controles y el cursor. */
const IDLE_MS = 2500;

interface WebkitDocument {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface WebkitVideo {
  webkitEnterFullscreen?: () => void;
}

/**
 * Pantalla completa del escenario de una pantalla compartida (sala y videollamada).
 *
 *   <div appFullscreenFrame #fs="fullscreenFrame" class="group relative ...">
 *     <video ...></video>
 *     <button (click)="fs.toggle()" ...>…</button>
 *   </div>
 *
 * - Pone en pantalla completa el CONTENEDOR (no el `<video>`), así siguen visibles el nombre de quien
 *   presenta y el botón para salir. Doble clic también alterna; Esc lo cierra el navegador.
 * - En pantalla completa, tras `IDLE_MS` sin mover el puntero, `idle()` oculta controles y cursor.
 * - Safari usa los métodos `webkit*`; en iPhone solo el `<video>` puede ir a pantalla completa
 *   (`webkitEnterFullscreen`), sin controles propios.
 */
@Directive({
  selector: '[appFullscreenFrame]',
  exportAs: 'fullscreenFrame',
  host: {
    '[attr.data-fullscreen]': 'active() ? "" : null',
    '[class.cursor-none]': 'idle()',
    '(dblclick)': 'onDoubleClick($event)',
    '(pointermove)': 'wake()',
    '(pointerdown)': 'wake()',
  },
})
export class FullscreenFrameDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly doc = this.host.ownerDocument;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly fullscreenElement = signal<Element | null>(null);
  private readonly asleep = signal(false);

  /** El navegador permite pantalla completa (o, en iPhone, la del `<video>`). */
  get supported(): boolean {
    return !!(this.doc.fullscreenEnabled || (this.doc as WebkitDocument).webkitFullscreenEnabled || this.videoFallback());
  }
  readonly active = computed(() => this.fullscreenElement() === this.host);
  readonly idle = computed(() => this.active() && this.asleep());

  constructor() {
    const sync = (): void => {
      this.fullscreenElement.set(this.doc.fullscreenElement ?? (this.doc as WebkitDocument).webkitFullscreenElement ?? null);
      this.wake();
    };
    this.doc.addEventListener('fullscreenchange', sync);
    this.doc.addEventListener('webkitfullscreenchange', sync);
    inject(DestroyRef).onDestroy(() => {
      this.doc.removeEventListener('fullscreenchange', sync);
      this.doc.removeEventListener('webkitfullscreenchange', sync);
      this.clearIdle();
      if (this.active()) void this.exit(); // la vista se va (dejó de compartir): no dejar la página atrapada
    });
  }

  async toggle(): Promise<void> {
    if (this.active()) {
      await this.exit();
      return;
    }
    const el = this.host as HTMLElement & WebkitElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else this.videoFallback()?.webkitEnterFullscreen?.();
    } catch {
      // El navegador lo negó (sin gesto del usuario, iframe sin permiso): sin ruido, sigue igual.
    }
  }

  protected onDoubleClick(event: MouseEvent): void {
    // Doble clic sobre un control (volumen, botones) no debe alternar.
    if ((event.target as HTMLElement | null)?.closest('button, input, label, a')) return;
    void this.toggle();
  }

  /** Movimiento del puntero: muestra controles y reprograma el ocultado (solo en pantalla completa). */
  protected wake(): void {
    this.asleep.set(false);
    this.clearIdle();
    if (this.active()) this.idleTimer = setTimeout(() => this.asleep.set(true), IDLE_MS);
  }

  private async exit(): Promise<void> {
    const doc = this.doc as Document & WebkitDocument;
    try {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
    } catch {
      // Ya había salido (Esc entre medio).
    }
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private videoFallback(): (HTMLVideoElement & WebkitVideo) | null {
    const video = this.host.querySelector('video') as (HTMLVideoElement & WebkitVideo) | null;
    return video && typeof video.webkitEnterFullscreen === 'function' ? video : null;
  }
}
