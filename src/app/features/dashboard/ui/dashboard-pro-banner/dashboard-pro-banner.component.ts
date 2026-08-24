import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

/**
 * Banner promocional PRO: tarjeta oscura con degradado, chip "PRO" flotante y
 * flecha. No muestra métricas del negocio, así que no había cifras que
 * corregir — el problema era que la flecha no llevaba a ninguna parte, lo que
 * hacía que la tarjeta pareciera decorado.
 *
 * Ahora es un enlace real a `/plans` (los planes vienen del backend), que es
 * exactamente lo que promete el texto.
 */
@Component({
  selector: 'app-dashboard-pro-banner',
  imports: [CommonModule, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-pro-banner.component.html',
  styleUrl: './dashboard-pro-banner.component.css',
})
export class DashboardProBannerComponent {}
