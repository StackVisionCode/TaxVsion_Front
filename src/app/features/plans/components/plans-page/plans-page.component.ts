import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlansStore } from '../../data-access/plans.store';

/**
 * Página de Planes: contenedor "smart" — inyecta el store y dispara la carga.
 * Primer ejemplo de feature cableada de punta a punta contra el backend real
 * (GET /plans vía gateway). Sirve de molde para el resto de las features.
 */
@Component({
  selector: 'app-plans-page',
  imports: [CommonModule],
  templateUrl: './plans-page.component.html',
})
export class PlansPageComponent implements OnInit {
  readonly store = inject(PlansStore);

  ngOnInit(): void {
    this.store.load();
  }

  gbOf(bytes: number): number {
    return Math.round(bytes / (1024 * 1024 * 1024));
  }
}
