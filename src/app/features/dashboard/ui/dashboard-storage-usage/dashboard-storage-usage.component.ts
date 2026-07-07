import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UsedStorageCardComponent, UsedStorageGroup } from '../../../../shared/ui/used-storage-card/used-storage-card.component';

const GB = 1024 ** 3;

/** Mismo desglose por categoría que la página de Storage, para que ambos lugares coincidan. */
const SEED_GROUPS: UsedStorageGroup[] = [
  { name: 'Documents', color: '#7C6AE0', sizeBytes: Math.round(12.4 * GB) },
  { name: 'Images', color: '#6AA7E0', sizeBytes: Math.round(9.6 * GB) },
  { name: 'Video & Audio', color: '#5FBFA3', sizeBytes: Math.round(14.7 * GB) },
  { name: 'Others', color: '#E0A16A', sizeBytes: Math.round(3.3 * GB) },
  { name: 'Trash', color: '#E06A9A', sizeBytes: Math.round(2.1 * GB) },
];

/**
 * Widget "Storage" del dashboard: reusa el mismo `app-used-storage-card` que
 * la página de Storage (donut de puntos + leyenda + Storage Type), con el
 * mismo desglose de datos, para que ambos lugares se vean idénticos.
 */
@Component({
  selector: 'app-dashboard-storage-usage',
  imports: [CommonModule, UsedStorageCardComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-storage-usage.component.html',
})
export class DashboardStorageUsageComponent {
  readonly totalBytes = 100 * GB;
  readonly groups = SEED_GROUPS;
  readonly uploadBytes = Math.round(31.2 * GB);
  readonly downloadBytes = Math.round(10.9 * GB);
}
