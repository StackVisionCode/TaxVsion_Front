import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Injector,
  Input,
  OnDestroy,
  Output,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { ClickOutsideDirective } from '../../directives/click-outside.directive';
import { portalToBody } from '../../utils/overlay.util';

export type DropdownAlign = 'right' | 'left';

export interface PanelPosition {
  top: number;
  left: number;
  /** Abre hacia arriba porque abajo no cabe. */
  up: boolean;
}

/** Separación entre disparador y panel, y margen mínimo contra los bordes de la ventana. */
const GAP_PX = 8;
const EDGE_PX = 8;

/**
 * Posición del panel: abajo si cabe; si no y arriba hay más sitio, arriba. Siempre dentro de la
 * ventana (con `EDGE_PX` de margen). Pura para poder probarla sin layout.
 */
export function computeMenuPosition(
  trigger: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  align: DropdownAlign,
): PanelPosition {
  const spaceBelow = viewport.height - trigger.bottom - GAP_PX - EDGE_PX;
  const spaceAbove = trigger.top - GAP_PX - EDGE_PX;
  const up = panel.height > spaceBelow && spaceAbove > spaceBelow;

  const rawTop = up ? trigger.top - GAP_PX - panel.height : trigger.bottom + GAP_PX;
  const top = clamp(rawTop, EDGE_PX, viewport.height - panel.height - EDGE_PX);
  const rawLeft = align === 'left' ? trigger.left : trigger.right - panel.width;
  const left = clamp(rawLeft, EDGE_PX, viewport.width - panel.width - EDGE_PX);
  return { top, left, up };
}

/**
 * Menú desplegable de acciones (el "⋯" de las filas de tabla) con contenido proyectado.
 *
 * Uso:
 * ```html
 * <app-dropdown-menu [ariaLabel]="'Actions for ' + row.name">
 *   <button appMenuItem type="button" (click)="edit(row)"><ion-icon name="create-outline" class="text-base"></ion-icon> Edit</button>
 *   <button appMenuItem [danger]="true" type="button" (click)="archive(row)">…</button>
 * </app-dropdown-menu>
 * ```
 * Importar `DropdownMenuComponent` + `MenuItemDirective`.
 *
 * - Disparador por defecto: botón redondo h-8 w-8 con `triggerIcon` (default
 *   'ellipsis-horizontal-outline'). Disparador propio: proyectar un elemento con el atributo
 *   `menuTrigger` (`<button menuTrigger …>`); el clic en él abre/cierra igual.
 * - El clic en el disparador NO se propaga (las filas suelen ser clicables) y el clic dentro del
 *   panel tampoco.
 * - Cierra al pulsar un `appMenuItem`, al pulsar fuera y con Escape. Contenido que no es
 *   `appMenuItem` (p. ej. el stepper de stock de inventory) no cierra el menú.
 * - `align`: 'right' (default, borde derecho con el disparador) | 'left'. `panelClass` sustituye el
 *   ancho mínimo (`min-w-[11.25rem]`) si hace falta, p. ej. 'w-52'.
 * - `(openChange)` avisa de cada apertura/cierre.
 *
 * El panel se porta al `<body>` con `position: fixed` calculado desde el disparador: así ningún
 * contenedor con `overflow` (tablas con scroll horizontal) ni ancestro con `transform` lo recorta.
 * Si abajo no cabe abre hacia arriba, nunca se sale de la ventana y sigue al disparador al hacer
 * scroll o cambiar el tamaño.
 */
@Component({
  selector: 'app-dropdown-menu',
  imports: [NgClass, ClickOutsideDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'relative inline-block' },
  template: `
    <div #wrap class="relative" appClickOutside [clickOutsideEnabled]="open()" [clickOutsideIgnore]="panelEl()"
      (appClickOutside)="close()">
      <span class="dm-custom-trigger contents" (click)="onTriggerClick($event)"><ng-content select="[menuTrigger]"></ng-content></span>
      <button type="button" (click)="onTriggerClick($event)" [disabled]="disabled"
        class="dm-default-trigger flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        [attr.aria-label]="ariaLabel" aria-haspopup="menu" [attr.aria-expanded]="open()">
        <ion-icon [name]="triggerIcon" class="text-base"></ion-icon>
      </button>

      @if (open()) {
        <div #panel role="menu" (click)="$event.stopPropagation()"
          class="dm-panel menu-pop fixed z-[85] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg"
          [style.top.px]="position()?.top ?? 0" [style.left.px]="position()?.left ?? 0"
          [style.visibility]="position() ? 'visible' : 'hidden'"
          [ngClass]="[origin(), panelClass || 'min-w-[11.25rem]']">
          <ng-content></ng-content>
        </div>
      }
    </div>
  `,
  styles: `
    /* Con disparador proyectado, el botón por defecto no se pinta. */
    .dm-custom-trigger:not(:empty) + .dm-default-trigger {
      display: none;
    }

    /* Entrada con un pequeño zoom desde la esquina (misma animación que client-table). */
    .menu-pop {
      animation: menu-pop-in 130ms cubic-bezier(0.2, 0.7, 0.2, 1);
    }
    @keyframes menu-pop-in {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(-2px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .menu-pop {
        animation: none;
      }
    }
  `,
})
export class DropdownMenuComponent implements OnDestroy {
  @Input() align: DropdownAlign = 'right';
  @Input() triggerIcon = 'ellipsis-horizontal-outline';
  @Input() ariaLabel = 'More actions';
  @Input() disabled = false;
  /** Clases de ancho del panel; por defecto `min-w-[11.25rem]`. */
  @Input() panelClass = '';
  @Output() readonly openChange = new EventEmitter<boolean>();

  readonly open = signal(false);
  readonly position = signal<PanelPosition | null>(null);
  readonly panelEl = signal<HTMLElement | null>(null);

  private readonly wrap = viewChild.required<ElementRef<HTMLElement>>('wrap');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly injector = inject(Injector);
  private readonly reposition = (): void => this.place();

  onTriggerClick(event: Event): void {
    event.stopPropagation();
    if (this.disabled) {
      return;
    }
    this.setOpen(!this.open());
  }

  close(): void {
    this.setOpen(false);
  }

  origin(): string {
    const vertical = this.position()?.up ? 'bottom' : 'top';
    return `origin-${vertical}-${this.align === 'left' ? 'left' : 'right'}`;
  }

  ngOnDestroy(): void {
    // Si el anfitrión muere con el menú abierto, Angular solo quita el host: el panel portado se va a mano.
    const panel = this.panelEl();
    this.detach();
    panel?.remove();
  }

  private setOpen(next: boolean): void {
    if (this.open() === next) {
      return;
    }
    this.open.set(next);
    this.openChange.emit(next);
    if (next) {
      afterNextRender(() => this.attach(), { injector: this.injector });
    } else {
      this.detach();
    }
  }

  private attach(): void {
    const panel = this.panel()?.nativeElement;
    if (!panel || !this.open()) {
      return;
    }
    this.panelEl.set(portalToBody(panel));
    this.place();
    window.addEventListener('scroll', this.reposition, { capture: true, passive: true });
    window.addEventListener('resize', this.reposition, { passive: true });
  }

  private detach(): void {
    window.removeEventListener('scroll', this.reposition, { capture: true });
    window.removeEventListener('resize', this.reposition);
    this.position.set(null);
    this.panelEl.set(null);
  }

  private place(): void {
    const panel = this.panelEl();
    if (!panel) {
      return;
    }
    const trigger = this.wrap().nativeElement.getBoundingClientRect();
    if (trigger.bottom < 0 || trigger.top > window.innerHeight) {
      // El disparador salió de la pantalla con el scroll: el menú ya no tiene a qué anclarse.
      this.close();
      return;
    }
    this.position.set(
      computeMenuPosition(
        trigger,
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        this.align,
      ),
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/**
 * Ítem de `app-dropdown-menu` (atributo sobre un `<button>`): aplica las clases comunes de ítem y
 * cierra el menú tras el clic. `[danger]` lo pinta en rojo (acciones destructivas).
 */
@Directive({
  selector: '[appMenuItem]',
  host: {
    role: 'menuitem',
    class:
      'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    '[class.text-gray-700]': '!danger',
    '[class.text-red-500]': 'danger',
  },
})
export class MenuItemDirective {
  @Input() danger = false;

  private readonly menu = inject(DropdownMenuComponent, { optional: true });

  @HostListener('click')
  onClick(): void {
    this.menu?.close();
  }
}
