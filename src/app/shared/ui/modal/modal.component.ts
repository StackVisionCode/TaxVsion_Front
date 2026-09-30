import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  effect,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { captureActiveElement, focusablesIn, setBodyScrollLock, trapTabKey } from '../../utils/overlay.util';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

/** Id incremental para asociar `aria-labelledby` con el título de cada instancia. */
let modalInstanceSeq = 0;

/** Ancho máximo del panel por tamaño (Tailwind). */
const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-6xl',
};

/** Duración de la animación de salida (debe casar con el keyframe del CSS). */
const EXIT_MS = 180;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Bloqueo de scroll (contador compartido con app-drawer), enfocables y focus-trap viven en
// shared/utils/overlay.util.ts; el comportamiento del modal no cambia.

/**
 * Shell de modal reusable (estilo "Aether"): backdrop oscuro que cierra al
 * click, panel blanco centrado `rounded-[28px]` con scroll interno, header
 * con título/subtítulo + botón X, y un único `<ng-content>` para el cuerpo
 * (los botones de pie viajan como parte del contenido, todo scrollea junto).
 * Cierra también con Escape. Es el esqueleto común extraído de los 9
 * form-panels de las features; los inputs se llaman `heading`/`subheading`
 * (no `title`) para no disparar el tooltip nativo del navegador en el host.
 *
 * Entrada Y salida animadas: el desmontaje se DIFIERE `EXIT_MS` para que el
 * cierre haga fade-out en vez de desaparecer en seco (`rendered`/`closing`
 * internos, independientes del `isOpen` del padre). Con
 * `prefers-reduced-motion` el cierre es inmediato (sin diferir).
 */
@Component({
  selector: 'app-modal',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.css',
})
export class ModalComponent implements OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() heading = '';
  @Input() subheading = '';
  @Input() size: ModalSize = 'lg';
  @Output() closed = new EventEmitter<void>();

  @ViewChild('panel') panelRef?: ElementRef<HTMLElement>;

  /** Id del `<h2>` del título, para `aria-labelledby` (lectores de pantalla anuncian el diálogo). */
  readonly headingId = `modal-title-${modalInstanceSeq++}`;

  /** Se mantiene montado durante la animación de salida aunque `isOpen` ya sea false. */
  readonly rendered = signal(false);
  /** Reproduce los keyframes de salida mientras se difiere el desmontaje. */
  readonly closing = signal(false);

  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private hasScrollLock = false;
  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const open = this.rendered();
      // Mientras el modal esté montado (abierto o saliendo), bloquea el scroll del fondo.
      this.reconcileScrollLock(open);
      // Foco: al abrir se lleva al panel; al cerrar (fin de la salida) vuelve al disparador.
      if (open) {
        this.captureAndFocus();
      } else {
        this.restoreFocus();
      }
    });
  }

  get sizeClass(): string {
    return SIZE_CLASSES[this.size];
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['isOpen']) {
      return;
    }
    if (this.isOpen) {
      this.clearExit();
      this.closing.set(false);
      this.rendered.set(true);
    } else if (this.rendered()) {
      this.beginClose();
    }
  }

  ngOnDestroy(): void {
    this.clearExit();
    this.reconcileScrollLock(false);
    this.restoreFocus();
  }

  /** Suma/resta al contador global de bloqueo solo una vez por instancia (evita descuadres). */
  private reconcileScrollLock(open: boolean): void {
    if (open && !this.hasScrollLock) {
      this.hasScrollLock = true;
      setBodyScrollLock(true);
    } else if (!open && this.hasScrollLock) {
      this.hasScrollLock = false;
      setBodyScrollLock(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) {
      this.closed.emit();
    }
  }

  /**
   * Focus-trap: con el modal abierto, Tab/Shift+Tab ciclan dentro del panel en vez de escaparse al
   * fondo (que además está inerte por el backdrop). Si el foco se sale, lo trae de vuelta.
   */
  @HostListener('document:keydown.tab', ['$event'])
  @HostListener('document:keydown.shift.tab', ['$event'])
  onTab(rawEvent: Event): void {
    const event = rawEvent as KeyboardEvent;
    const panel = this.panelRef?.nativeElement;
    if (!this.rendered() || !panel) {
      return;
    }
    trapTabKey(event, panel);
  }

  close(): void {
    this.closed.emit();
  }

  private captureAndFocus(): void {
    // En el momento de abrir, el foco sigue en el disparador (el DOM del modal aún no lo tiene).
    const active = captureActiveElement();
    if (active) {
      this.returnFocusTo = active;
    }
    // El contenido proyectado se pinta tras este ciclo; se difiere el foco para encontrarlo montado.
    setTimeout(() => {
      const panel = this.panelRef?.nativeElement;
      if (!panel) {
        return;
      }
      (this.focusables()[0] ?? panel).focus();
    });
  }

  private restoreFocus(): void {
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    // `focus()` es no-op si el disparador ya no está en el DOM.
    target?.focus?.();
  }

  private focusables(): HTMLElement[] {
    return focusablesIn(this.panelRef?.nativeElement);
  }

  private beginClose(): void {
    if (prefersReducedMotion()) {
      this.rendered.set(false);
      this.closing.set(false);
      return;
    }
    this.closing.set(true);
    this.clearExit();
    this.exitTimer = setTimeout(() => {
      this.rendered.set(false);
      this.closing.set(false);
      this.exitTimer = null;
    }, EXIT_MS);
  }

  private clearExit(): void {
    if (this.exitTimer) {
      clearTimeout(this.exitTimer);
      this.exitTimer = null;
    }
  }
}
