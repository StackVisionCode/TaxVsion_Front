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
import { NgClass } from '@angular/common';
import { captureActiveElement, focusablesIn, portalToBody, setBodyScrollLock, trapTabKey } from '../../utils/overlay.util';
import { prefersReducedMotion } from '../../utils/reduced-motion.util';

export type DrawerWidth = 'md' | 'lg' | 'xl';
export type DrawerSide = 'right' | 'left';

const WIDTH_CLASSES: Record<DrawerWidth, string> = {
  md: 'max-w-md',
  lg: 'max-w-[560px]',
  xl: 'max-w-2xl',
};

/** Duración de la salida (debe casar con los keyframes `*-out` del CSS). */
const EXIT_MS = 180;

let drawerInstanceSeq = 0;

/**
 * Panel lateral (slide-over) con backdrop. Hermano de `app-modal`: mismo contrato de apertura
 * (`isOpen` controlado por el padre + `(closed)`), mismo bloqueo de scroll (contador compartido en
 * shared/utils/overlay.util), focus-trap, retorno del foco al disparador, Escape y salida animada.
 *
 * Uso:
 * ```html
 * <app-drawer [isOpen]="!!task()" heading="Task detail" subheading="…" width="md" (closed)="task.set(null)">
 *   …cuerpo (scrollea)…
 *   <div drawerFooter class="flex justify-end gap-2">…botones…</div>
 * </app-drawer>
 * ```
 *
 * Inputs: `isOpen`, `heading`, `subheading`, `width` ('md' = max-w-md como task-detail-drawer ·
 * 'lg' = 560px como edit-access-drawer · 'xl' = max-w-2xl), `side` ('right' default | 'left'),
 * `bodyClass` (padding del cuerpo, default 'p-6'), `ariaLabel` (si no hay heading).
 * Output: `(closed)` — backdrop, X o Escape; el padre decide cerrar poniendo `isOpen=false`.
 * Slots: contenido por defecto = cuerpo con scroll; `[drawerFooter]` = pie fijo con borde superior
 * (no se pinta si no se proyecta). Sin `heading` no hay cabecera (el cuerpo trae la suya).
 *
 * Normalizado: task-detail-drawer usa backdrop `bg-black/30` z-40 + panel z-50 `shadow-2xl` (tomado
 * aquí); edit-access-drawer usaba `bg-slate-900/40` + blur y z-[60]. Ninguna copia tenía focus-trap
 * ni bloqueo de scroll.
 */
@Component({
  selector: 'app-drawer',
  imports: [NgClass],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  styleUrl: './drawer.component.css',
  template: `
    @if (rendered()) {
      <div #portal>
      <div class="drawer-backdrop fixed inset-0 z-40 bg-black/30" [class.is-closing]="closing()" (click)="close()"></div>
      <aside #panel role="dialog" aria-modal="true" tabindex="-1"
        [attr.aria-labelledby]="heading ? headingId : null" [attr.aria-label]="heading ? null : ariaLabel || null"
        class="drawer-panel fixed inset-y-0 z-50 flex w-full flex-col bg-white shadow-2xl focus:outline-none"
        [ngClass]="[widthClass, side === 'left' ? 'left-0 is-left' : 'right-0']" [class.is-closing]="closing()">
        @if (heading) {
          <div class="flex items-start justify-between gap-3 border-b border-gray-100 p-6">
            <div class="min-w-0">
              <h2 [id]="headingId" class="text-xl font-bold text-gray-900">{{ heading }}</h2>
              @if (subheading) {
                <p class="mt-1 text-sm text-gray-500">{{ subheading }}</p>
              }
            </div>
            <button type="button" (click)="close()" aria-label="Close panel"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition-colors">
              <ion-icon name="close-outline" class="text-lg"></ion-icon>
            </button>
          </div>
        }
        <div class="min-h-0 flex-1 overflow-y-auto" [ngClass]="bodyClass">
          <ng-content></ng-content>
        </div>
        <div class="border-t border-gray-100 px-6 py-4 empty:hidden"><ng-content select="[drawerFooter]"></ng-content></div>
      </aside>
      </div>
    }
  `,
})
export class DrawerComponent implements OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() heading = '';
  @Input() subheading = '';
  @Input() width: DrawerWidth = 'md';
  @Input() side: DrawerSide = 'right';
  @Input() bodyClass = 'p-6';
  @Input() ariaLabel = '';
  @Output() readonly closed = new EventEmitter<void>();

  @ViewChild('panel') panelRef?: ElementRef<HTMLElement>;
  /** Contenedor de backdrop + panel, portado al <body> como un solo nodo (ver `portalToBody`). */
  @ViewChild('portal')
  private set portalRef(ref: ElementRef<HTMLElement> | undefined) {
    this.portaled = portalToBody(ref?.nativeElement) ?? this.portaled;
  }
  private portaled: HTMLElement | null = null;

  readonly headingId = `drawer-title-${drawerInstanceSeq++}`;
  /** Montado (abierto o animando la salida). */
  readonly rendered = signal(false);
  readonly closing = signal(false);

  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private hasScrollLock = false;
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const open = this.rendered();
      this.reconcileScrollLock(open);
      if (open) {
        this.captureAndFocus();
      } else {
        this.restoreFocus();
      }
    });
  }

  get widthClass(): string {
    return WIDTH_CLASSES[this.width] ?? WIDTH_CLASSES.md;
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
    this.portaled?.remove();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) {
      this.closed.emit();
    }
  }

  @HostListener('document:keydown.tab', ['$event'])
  @HostListener('document:keydown.shift.tab', ['$event'])
  onTab(rawEvent: Event): void {
    const panel = this.panelRef?.nativeElement;
    if (!this.rendered() || !panel) {
      return;
    }
    trapTabKey(rawEvent as KeyboardEvent, panel);
  }

  close(): void {
    this.closed.emit();
  }

  private reconcileScrollLock(open: boolean): void {
    if (open && !this.hasScrollLock) {
      this.hasScrollLock = true;
      setBodyScrollLock(true);
    } else if (!open && this.hasScrollLock) {
      this.hasScrollLock = false;
      setBodyScrollLock(false);
    }
  }

  private captureAndFocus(): void {
    const active = captureActiveElement();
    if (active) {
      this.returnFocusTo = active;
    }
    setTimeout(() => {
      const panel = this.panelRef?.nativeElement;
      if (panel) {
        (focusablesIn(panel)[0] ?? panel).focus();
      }
    });
  }

  private restoreFocus(): void {
    const target = this.returnFocusTo;
    this.returnFocusTo = null;
    target?.focus?.();
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
