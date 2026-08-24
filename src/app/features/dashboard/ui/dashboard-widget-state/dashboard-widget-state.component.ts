import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Bloque compartido de estado para los widgets del dashboard: cargando, error
 * o vacío. Existe para que TODOS los widgets digan la verdad de la misma forma
 * — antes cada uno pintaba literales inventados (ingresos, clientes, chats…)
 * que en producción se leían como datos reales del negocio.
 *
 * Sigue el patrón que ya usaba `dashboard-storage-usage` (único widget que
 * estaba conectado de verdad): placeholder con altura mínima para que la
 * grilla no salte, mensaje de error del backend tal cual, y vacío sin cifras
 * de adorno.
 *
 * El padre decide CUÁNDO mostrarlo (cuando no hay filas que pintar); este
 * componente solo decide CUÁL de los tres estados corresponde.
 */
@Component({
  selector: 'app-dashboard-widget-state',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-widget-state.component.html',
})
export class DashboardWidgetStateComponent {
  /** Hay una petición en curso: se muestra el spinner. */
  @Input() loading = false;

  /** Mensaje de error ya normalizado (`toApiError(...).message`), o null. */
  @Input() error: string | null = null;

  /** Titular del estado vacío. Debe ser honesto: nunca una cifra. */
  @Input() title = 'No data yet';

  /** Línea secundaria opcional del estado vacío. */
  @Input() message = '';

  /** Icono de ionicons para el estado vacío. */
  @Input() icon = 'information-circle-outline';

  /** Encabezado del estado de error, p. ej. "Invoices aren't available". */
  @Input() errorTitle = "This data isn't available";

  /** Alto mínimo del bloque; los widgets altos usan uno mayor para no encoger. */
  @Input() minHeight = '10rem';
}
