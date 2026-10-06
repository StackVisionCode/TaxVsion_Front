import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Directive,
  EventEmitter,
  HostListener,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { ClickOutsideDirective } from '../../directives/click-outside.directive';

export type DropdownAlign = 'right' | 'left';

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
 * - `align`: 'right' (default, `right-0`) | 'left' (`left-0`). `panelClass` sustituye el ancho
 *   mínimo (`min-w-[180px]`) si hace falta, p. ej. 'w-52'.
 * - `(openChange)` avisa de cada apertura/cierre.
 *
 * Normalizado respecto a las copias (client-table, product-table, invoice-table, user-table): cada
 * una fijaba un ancho (`w-48`/`w-52`) y un `data-dropdown` + HostListener propios; aquí el panel
 * usa `min-w-[180px]` y la animación `menu-pop` de client-table (sin movimiento con reduced-motion).
 */
@Component({
  selector: 'app-dropdown-menu',
  imports: [NgClass, ClickOutsideDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { class: 'relative inline-block' },
  template: `
    <div class="relative" appClickOutside [clickOutsideEnabled]="open()" (appClickOutside)="close()">
      <span class="dm-custom-trigger contents" (click)="onTriggerClick($event)"><ng-content select="[menuTrigger]"></ng-content></span>
      <button type="button" (click)="onTriggerClick($event)" [disabled]="disabled"
        class="dm-default-trigger flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        [attr.aria-label]="ariaLabel" aria-haspopup="menu" [attr.aria-expanded]="open()">
        <ion-icon [name]="triggerIcon" class="text-base"></ion-icon>
      </button>

      @if (open()) {
        <div role="menu" (click)="$event.stopPropagation()"
          class="menu-pop absolute top-full z-20 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg"
          [ngClass]="[align === 'left' ? 'left-0 origin-top-left' : 'right-0 origin-top-right', panelClass || 'min-w-[180px]']">
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
export class DropdownMenuComponent {
  @Input() align: DropdownAlign = 'right';
  @Input() triggerIcon = 'ellipsis-horizontal-outline';
  @Input() ariaLabel = 'More actions';
  @Input() disabled = false;
  /** Clases de ancho del panel; por defecto `min-w-[180px]`. */
  @Input() panelClass = '';
  @Output() readonly openChange = new EventEmitter<boolean>();

  readonly open = signal(false);

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

  private setOpen(next: boolean): void {
    if (this.open() === next) {
      return;
    }
    this.open.set(next);
    this.openChange.emit(next);
  }
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
