import { Component, Input, Output, EventEmitter, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

/**
 * Control de paginación reusable (estilo "Aether"): texto "Showing X–Y of Z"
 * a la izquierda + píldoras Prev/Next con la página actual a la derecha. Se
 * oculta solo cuando todo cabe en una página. Puramente presentacional: el
 * padre es dueño del signal de página actual y decide cómo cortar sus datos.
 */
@Component({
  selector: 'app-pagination',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './pagination.component.html',
})
export class PaginationComponent {
  @Input() currentPage = 1;
  @Input() totalItems = 0;
  @Input() pageSize = 8;
  @Output() pageChange = new EventEmitter<number>();

  private readonly currentPageSig = signal(1);
  private readonly totalItemsSig = signal(0);
  private readonly pageSizeSig = signal(8);

  ngOnChanges(): void {
    this.currentPageSig.set(this.currentPage);
    this.totalItemsSig.set(this.totalItems);
    this.pageSizeSig.set(this.pageSize || 8);
  }

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalItemsSig() / this.pageSizeSig())));

  readonly rangeStart = computed(() => (this.totalItemsSig() === 0 ? 0 : (this.currentPageSig() - 1) * this.pageSizeSig() + 1));

  readonly rangeEnd = computed(() => Math.min(this.currentPageSig() * this.pageSizeSig(), this.totalItemsSig()));

  readonly showControls = computed(() => this.totalItemsSig() > this.pageSizeSig());

  goToPrevious(): void {
    if (this.currentPage > 1) {
      this.pageChange.emit(this.currentPage - 1);
    }
  }

  goToNext(): void {
    if (this.currentPage < this.totalPages()) {
      this.pageChange.emit(this.currentPage + 1);
    }
  }
}
