import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { FloatingPosition, clampPosition } from '../../utils/meeting-room-storage.util';

const DOCK_MARGIN = 12;
const KEYBOARD_STEP = 24;

/**
 * Panel flotante y ARRASTRABLE con las cámaras mientras hay pantalla compartida (o un participante
 * fijado en el escenario). Arranca acoplado abajo-izquierda; el usuario lo mueve con el mouse/dedo
 * (pointer events + pointer capture) o con las flechas del teclado desde el asa. La posición queda
 * siempre dentro del contenedor (se re-limita si el contenedor cambia de tamaño: zoom, rotación,
 * panel lateral) y se emite al soltar para que la sala la recuerde en la sesión.
 *
 * El contenedor padre debe ser `position: relative`.
 */
@Component({
  selector: 'app-meeting-floating-panel',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meeting-floating-panel.component.html',
  styleUrl: './meeting-floating-panel.component.css',
  host: {
    class: 'floating-panel absolute z-20 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-gray-900/85 shadow-2xl backdrop-blur-md',
    '[style.left.px]': 'pos()?.x ?? dockMargin',
    '[style.top.px]': 'pos()?.y ?? null',
    '[style.bottom.px]': 'pos() ? null : dockMargin',
    '[class.floating-panel--dragging]': 'dragging()',
  },
})
export class MeetingFloatingPanelComponent {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  @Input() title = 'Participants';
  @Input() count = 0;
  @Input() set position(value: FloatingPosition | null) {
    this.pos.set(value);
    // Tras pintar, asegurar que la posición recordada entra en el contenedor actual.
    queueMicrotask(() => this.reclamp(false));
  }

  @Output() positionChange = new EventEmitter<FloatingPosition | null>();

  readonly dockMargin = DOCK_MARGIN;
  readonly pos = signal<FloatingPosition | null>(null);
  readonly dragging = signal(false);
  readonly collapsed = signal(false);

  private dragStart: { pointerX: number; pointerY: number; x: number; y: number } | null = null;

  constructor() {
    afterNextRender(() => {
      const parent = this.el.nativeElement.parentElement;
      if (!parent || typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(() => this.reclamp(true));
      observer.observe(parent);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update(c => !c);
    queueMicrotask(() => this.reclamp(true));
  }

  /** Vuelve a acoplarlo abajo-izquierda (doble click en el asa). */
  dock(): void {
    this.pos.set(null);
    this.positionChange.emit(null);
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return;
    }
    const current = this.currentPosition();
    this.dragStart = { pointerX: event.clientX, pointerY: event.clientY, x: current.x, y: current.y };
    this.dragging.set(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragStart) {
      return;
    }
    const next = {
      x: this.dragStart.x + (event.clientX - this.dragStart.pointerX),
      y: this.dragStart.y + (event.clientY - this.dragStart.pointerY),
    };
    this.pos.set(this.clamp(next));
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.dragStart) {
      return;
    }
    this.dragStart = null;
    this.dragging.set(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    this.positionChange.emit(this.pos());
  }

  /** Accesible: mover con las flechas desde el asa (Shift = paso grande). */
  onHandleKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? KEYBOARD_STEP * 3 : KEYBOARD_STEP;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (!delta) {
      return;
    }
    event.preventDefault();
    const current = this.currentPosition();
    const next = this.clamp({ x: current.x + delta[0], y: current.y + delta[1] });
    this.pos.set(next);
    this.positionChange.emit(next);
  }

  /** Posición actual en px (si está acoplado, se deriva de su caja real). */
  private currentPosition(): FloatingPosition {
    const explicit = this.pos();
    if (explicit) {
      return explicit;
    }
    const host = this.el.nativeElement;
    return { x: host.offsetLeft, y: host.offsetTop };
  }

  private clamp(pos: FloatingPosition): FloatingPosition {
    const host = this.el.nativeElement;
    const parent = host.parentElement;
    if (!parent) {
      return pos;
    }
    return clampPosition(
      pos,
      { width: host.offsetWidth, height: host.offsetHeight },
      { width: parent.clientWidth, height: parent.clientHeight },
      DOCK_MARGIN / 2,
    );
  }

  private reclamp(emit: boolean): void {
    const explicit = this.pos();
    if (!explicit || this.dragStart) {
      return;
    }
    const clamped = this.clamp(explicit);
    if (clamped.x !== explicit.x || clamped.y !== explicit.y) {
      this.pos.set(clamped);
      if (emit) {
        this.positionChange.emit(clamped);
      }
    }
  }
}
