import { Component, CUSTOM_ELEMENTS_SCHEMA, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DashboardLayoutStore } from '../../data-access/dashboard-layout.store';

type DashboardView = 'My Dashboard' | 'Team Dashboard' | 'Company Overview';

/**
 * Barra de filtros compacta sobre el dashboard (estilo "Aether"): selector de
 * vista tipo píldora, rango de fechas, botón Apply negro y el botón
 * "Edit layout" que activa el modo de reordenar widgets. Visual-only: los
 * filtros se "aplican" solo a un chip resumen local, nada consulta un backend.
 */
@Component({
  selector: 'app-dashboard-filters',
  imports: [CommonModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-filters.component.html',
})
export class DashboardFiltersComponent {
  readonly layout = inject(DashboardLayoutStore);

  readonly views: DashboardView[] = ['My Dashboard', 'Team Dashboard', 'Company Overview'];

  readonly view = signal<DashboardView>('My Dashboard');
  readonly isViewOpen = signal(false);

  readonly startDate = signal('');
  readonly endDate = signal('');

  /** Resumen del último filtro aplicado; null = sin filtros activos. */
  readonly applied = signal<string | null>(null);

  readonly canApply = computed(
    () => this.view() !== 'My Dashboard' || !!this.startDate() || !!this.endDate(),
  );

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-dropdown="dashboard-view"]') && this.isViewOpen()) {
      this.isViewOpen.set(false);
    }
  }

  toggleViewDropdown(): void {
    this.isViewOpen.update(open => !open);
  }

  selectView(view: DashboardView): void {
    this.view.set(view);
    this.isViewOpen.set(false);
  }

  apply(): void {
    const parts: string[] = [this.view()];
    if (this.startDate() && this.endDate()) {
      parts.push(`${this.formatDate(this.startDate())} – ${this.formatDate(this.endDate())}`);
    } else if (this.startDate()) {
      parts.push(`from ${this.formatDate(this.startDate())}`);
    } else if (this.endDate()) {
      parts.push(`until ${this.formatDate(this.endDate())}`);
    }
    this.applied.set(parts.join(' · '));
  }

  clear(): void {
    this.view.set('My Dashboard');
    this.startDate.set('');
    this.endDate.set('');
    this.applied.set(null);
  }

  private formatDate(iso: string): string {
    const date = new Date(`${iso}T00:00:00`);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
