import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardWidgetStateComponent } from '../dashboard-widget-state/dashboard-widget-state.component';

/**
 * Widget "Productivity Trends".
 *
 * Antes pintaba un gráfico de barras de "horas de foco" por día/semana con
 * datasets estáticos (14 h esta semana, +15% vs la anterior…) y un selector
 * Week/Month que solo intercambiaba esos dos arrays falsos.
 *
 * La plataforma NO tiene time tracking: ningún servicio registra horas
 * trabajadas por usuario ni las agrega por día o semana, así que no hay forma
 * de alimentar el gráfico sin inventarlo. Se deja el marco de la tarjeta con
 * un estado vacío honesto (el gráfico sin datos no aporta nada, pero borrar la
 * tarjeta dejaría un hueco en la grilla reordenable).
 *
 * El CSS de las barras (`trend-bar--*`) se conserva a propósito: el día que
 * exista el endpoint de horas, el gráfico vuelve sin rehacer estilos.
 */
@Component({
  selector: 'app-dashboard-productivity-trends',
  imports: [CommonModule, DashboardWidgetStateComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-productivity-trends.component.html',
  styleUrl: './dashboard-productivity-trends.component.css',
})
export class DashboardProductivityTrendsComponent {}
