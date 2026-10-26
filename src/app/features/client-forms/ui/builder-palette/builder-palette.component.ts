import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { catalogGroups } from '../../utils/component-catalog';
import {
  resetGhost,
  setGhostPosition,
  startPaletteDrag,
  type ClientPoint,
} from '@shared/utils/palette-drag.util';
import { portalToBody } from '@shared/utils/overlay.util';

export interface PaletteComponentDrop {
  type: string;
  point: ClientPoint;
}

@Component({
  selector: 'app-builder-palette',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Sin scroll propio: la columna del builder es la que scrollea (outline y paleta no se pisan). -->
    <aside class="px-4 pb-5 pt-3" aria-label="Form components">
      <p class="text-xs text-gray-600">
        @if (targetLabel) {
          Click or drag a block. It is added to
          <span class="font-semibold text-gray-900">{{ targetLabel }}</span>.
        } @else {
          Click or drag a block onto a section.
        }
      </p>
      @for (group of groups; track group.label) {
        <section class="mt-5">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {{ group.label }}
          </h3>
          <div class="grid grid-cols-2 gap-2">
            @for (item of group.items; track item.type) {
              <button
                type="button"
                class="flex min-h-16 min-w-0 flex-col items-start justify-between gap-1 rounded-2xl border border-gray-200 bg-white p-2 text-left text-xs font-semibold leading-tight text-gray-700 transition hover:border-brand-light hover:bg-brand-surface focus:outline-none focus:ring-2 focus:ring-brand-light disabled:cursor-not-allowed disabled:opacity-50"
                [disabled]="disabled || disabledTypes.includes(item.type)"
                [attr.title]="disabledTypes.includes(item.type) ? disabledReason : null"
                (pointerdown)="beginDrag($event, item.type, item.label)"
                (click)="add(item.type)"
                [attr.aria-label]="'Add ' + item.label"
              >
                <ion-icon [name]="item.icon" class="block text-lg text-brand-bold"></ion-icon>
                <span class="break-words">{{ item.label }}</span>
              </button>
            }
          </div>
        </section>
      }
    </aside>
    <div
      #ghost
      class="pointer-events-none fixed left-0 top-0 z-[95] min-w-36 items-center gap-2 rounded-full border border-brand-light bg-white px-3 py-2 text-sm font-semibold text-brand-ink shadow-xl"
      [class.flex]="dragging()"
      [class.hidden]="!dragging()"
      aria-hidden="true"
    >
      <ion-icon name="add-circle-outline" class="text-lg text-brand-bold"></ion-icon
      >{{ ghostLabel() }}
    </div>
  `,
})
export class BuilderPaletteComponent implements AfterViewInit, OnDestroy {
  @ViewChild('ghost', { static: true }) private ghost!: ElementRef<HTMLDivElement>;
  /** Solo lectura: ni clic ni arrastre agregan componentes. */
  @Input() disabled = false;
  /** Sección donde cae el clic ("Section 1 · Page 1"); vacío si no hay destino. */
  @Input() targetLabel = '';
  @Output() readonly componentAdded = new EventEmitter<string>();
  @Output() readonly componentDropped = new EventEmitter<PaletteComponentDrop>();
  /** Tipos que este usuario no puede agregar (p. ej. el paso de firma sin `configure_actions`). */
  @Input() disabledTypes: readonly string[] = [];
  @Input() disabledReason = '';
  /** Arrastre en curso: el panel flotante se vuelve transparente a los eventos para el drop. */
  @Output() readonly draggingChange = new EventEmitter<boolean>();
  readonly dragging = signal(false);
  readonly ghostLabel = signal('');
  private stopDrag: (() => void) | null = null;

  readonly groups = catalogGroups();

  // El fantasma (fixed) va al body: `.builder` tiene overflow y container query, que lo recortarían y desplazarían.
  ngAfterViewInit(): void {
    portalToBody(this.ghost.nativeElement);
  }

  add(type: string): void {
    if (!this.disabled && !this.disabledTypes.includes(type)) this.componentAdded.emit(type);
  }

  beginDrag(event: PointerEvent, type: string, label: string): void {
    if (this.disabled || this.disabledTypes.includes(type)) return;
    this.stopDrag?.();
    this.stopDrag = startPaletteDrag(event, {
      getScrollContainer: () => document.querySelector<HTMLElement>('[data-builder-canvas-scroll]'),
      onStart: (point) => {
        this.ghostLabel.set(label);
        this.dragging.set(true);
        this.draggingChange.emit(true);
        this.positionGhost(point);
      },
      onFrame: (point) => this.positionGhost(point),
      onDrop: (point) => {
        this.finishDrag();
        this.componentDropped.emit({ type, point });
      },
      onCancel: () => this.finishDrag(),
    });
  }

  ngOnDestroy(): void {
    this.stopDrag?.();
    this.ghost.nativeElement.remove();
  }

  private positionGhost(point: ClientPoint): void {
    setGhostPosition(this.ghost.nativeElement, point.clientX + 12, point.clientY + 12);
  }

  private finishDrag(): void {
    if (this.dragging()) this.draggingChange.emit(false);
    this.dragging.set(false);
    resetGhost(this.ghost.nativeElement);
    this.stopDrag = null;
  }
}
