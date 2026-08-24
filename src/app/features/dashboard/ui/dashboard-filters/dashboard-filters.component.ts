import { Component, CUSTOM_ELEMENTS_SCHEMA, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardLayoutStore } from '../../data-access/dashboard-layout.store';

/**
 * Barra de herramientas sobre el dashboard.
 *
 * Antes ofrecía un selector de vista (My/Team/Company Dashboard), un rango de
 * fechas y un botón "Apply" que NO consultaban nada: aplicar solo pintaba un
 * chip verde con el resumen, y el usuario se quedaba creyendo que los widgets
 * se habían recalculado para ese rango o esa vista. Es el peor tipo de dato
 * falso: no es una cifra, es una promesa de que las cifras cambiaron.
 *
 * Ninguno de los servicios que alimentan hoy los widgets acepta filtros por
 * rango de fechas ni por equipo/empresa, así que esos controles se retiran en
 * vez de fingir. Queda lo que sí es real: el modo edición del layout, que
 * reordena widgets de verdad y persiste el orden.
 */
@Component({
  selector: 'app-dashboard-filters',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-filters.component.html',
})
export class DashboardFiltersComponent {
  readonly layout = inject(DashboardLayoutStore);
}
