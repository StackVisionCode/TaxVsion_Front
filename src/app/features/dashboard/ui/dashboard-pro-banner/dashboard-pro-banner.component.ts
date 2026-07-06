import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Banner promocional PRO (referencia "Aether"): tarjeta oscura con degradado
 * (sin imagen externa), chip "PRO" flotante y botón circular con flecha.
 */
@Component({
  selector: 'app-dashboard-pro-banner',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-pro-banner.component.html',
  styleUrl: './dashboard-pro-banner.component.css',
})
export class DashboardProBannerComponent {}
