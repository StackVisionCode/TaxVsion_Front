import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Píldoras de "horas ahorradas" (referencia "Aether"): la del mes actual en
 * negro, ligeramente rotada y superpuesta sobre la del mes anterior en blanco.
 */
@Component({
  selector: 'app-dashboard-hours-saved',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-hours-saved.component.html',
})
export class DashboardHoursSavedComponent {}
