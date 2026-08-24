import { Component, CUSTOM_ELEMENTS_SCHEMA, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UsedStorageCardComponent } from '../../../../shared/ui/used-storage-card/used-storage-card.component';
import { StorageStore } from '../../../storage/data-access/storage.store';

/**
 * Widget "Storage" del dashboard: reusa el mismo `app-used-storage-card` que la
 * página de Storage y el mismo `StorageStore` (providedIn: 'root'), así ambos
 * lugares muestran exactamente la misma cuota real del tenant sin duplicar
 * llamadas — el store no re-lista si ya cargó.
 *
 * El backend no trae desglose por categoría en `/storage/usage` (solo totales):
 * el donut se computa client-side desde `/storage/files`, igual que en Storage.
 */
@Component({
  selector: 'app-dashboard-storage-usage',
  imports: [CommonModule, UsedStorageCardComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-storage-usage.component.html',
})
export class DashboardStorageUsageComponent implements OnInit {
  readonly store = inject(StorageStore);

  ngOnInit(): void {
    this.store.loadUsage();
    this.store.loadGroups();
  }
}
