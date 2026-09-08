import { ChangeDetectionStrategy, Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output } from '@angular/core';

/**
 * Barra flotante de acciones en lote — aparece abajo cuando hay archivos seleccionados.
 * Presentacional: recibe el conteo y emite la acción; la página la ejecuta contra el store.
 */
@Component({
  selector: 'app-bulk-action-bar',
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bulk-bar pointer-events-auto flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 pl-4 shadow-lg">
      <span class="whitespace-nowrap text-sm font-bold text-gray-800">{{ count }} selected</span>
      <span class="mx-0.5 h-5 w-px bg-gray-200"></span>
      <button type="button" (click)="download.emit()" class="bulk-btn"><ion-icon name="download-outline"></ion-icon> Download</button>
      <button type="button" (click)="move.emit()" class="bulk-btn"><ion-icon name="arrow-redo-outline"></ion-icon> Move</button>
      <button type="button" (click)="delete.emit()" class="bulk-btn bulk-btn-danger"><ion-icon name="trash-outline"></ion-icon> Delete</button>
      <span class="mx-0.5 h-5 w-px bg-gray-200"></span>
      <button type="button" (click)="clear.emit()" class="rounded-full px-3 py-1.5 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800">
        Clear
      </button>
    </div>
  `,
  styles: [
    `
      .bulk-bar {
        animation: bulk-rise 160ms cubic-bezier(0.2, 0, 0, 1) both;
      }
      @keyframes bulk-rise {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .bulk-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        border-radius: 9999px;
        padding: 0.375rem 0.75rem;
        font-size: 0.8125rem;
        font-weight: 600;
        color: rgb(var(--color-gray-700-rgb, 55 65 81));
        transition: background-color 120ms ease;
      }
      .bulk-btn:hover {
        background-color: rgb(var(--color-indigo-50-rgb, 245 247 250));
        color: rgb(var(--color-indigo-700-rgb, 19 44 67));
      }
      .bulk-btn-danger {
        color: rgb(220 38 38);
      }
      .bulk-btn-danger:hover {
        background-color: rgb(254 242 242);
        color: rgb(220 38 38);
      }
      @media (prefers-reduced-motion: reduce) {
        .bulk-bar {
          animation: none;
        }
      }
    `,
  ],
})
export class BulkActionBarComponent {
  @Input() count = 0;
  @Output() download = new EventEmitter<void>();
  @Output() move = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();
  @Output() clear = new EventEmitter<void>();
}
