import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Botón "Load more" de la paginación incremental (meetings, notifications).
 *
 * Uso: `<app-load-more [hasMore]="hasMore()" [loading]="loadingMore()" (load)="loadMore()" />`
 *
 * Markup de notifications-page: `mt-4 flex justify-center` + píldora `rounded-full border
 * border-gray-200 px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100
 * disabled:cursor-not-allowed disabled:opacity-50`; mientras carga dice "Loading…" y se deshabilita.
 * Normalizado: meetings usaba `text-gray-700`; se toma `text-gray-600` (notifications).
 * No se pinta nada si `hasMore` es false.
 */
@Component({
  selector: 'app-load-more',
  template: `
    @if (hasMore) {
      <div class="mt-4 flex justify-center">
        <button type="button" (click)="onClick()" [disabled]="loading" [attr.aria-busy]="loading"
          class="rounded-full border border-gray-200 px-5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50">
          {{ loading ? loadingLabel : label }}
        </button>
      </div>
    }
  `,
})
export class LoadMoreComponent {
  @Input() loading = false;
  @Input() hasMore = false;
  @Input() label = 'Load more';
  @Input() loadingLabel = 'Loading…';
  @Output() readonly load = new EventEmitter<void>();

  onClick(): void {
    if (!this.loading) {
      this.load.emit();
    }
  }
}
