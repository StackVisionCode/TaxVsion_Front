import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

/**
 * Tabla "Performance Analytics".
 *
 * Antes listaba corridas de procesos inventadas (Document OCR 97%, Fraud
 * detection 86%, Client data sync 74%) con fechas y duraciones falsas: en
 * producción eso se leía como telemetría real de la oficina.
 *
 * NINGÚN servicio del backend expone métricas de ejecución de procesos
 * (precisión/duración/estado por tarea), así que no hay nada real con lo que
 * alimentarla. Se conserva el marco de la tarjeta con un estado vacío honesto
 * en vez de borrarla del layout: cuando exista el endpoint, solo hay que
 * rellenar la tabla.
 */
@Component({
  selector: 'app-dashboard-performance-table',
  imports: [CommonModule, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-performance-table.component.html',
})
export class DashboardPerformanceTableComponent {}
