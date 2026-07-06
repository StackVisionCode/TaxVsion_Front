import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

type RowStatus = 'Success' | 'Warning' | 'Failed';

interface PerformanceRow {
  task: string;
  date: string;
  accuracy: string;
  duration: string;
  status: RowStatus;
}

/**
 * Tabla "Performance Analytics" (referencia "Aether"): fila de encabezado como
 * píldora blanca y status con punto de color. Datos estáticos, dominio CRM.
 */
@Component({
  selector: 'app-dashboard-performance-table',
  imports: [CommonModule],
  templateUrl: './dashboard-performance-table.component.html',
})
export class DashboardPerformanceTableComponent {
  readonly rows: PerformanceRow[] = [
    { task: 'Document OCR', date: '12 Dec, 2025', accuracy: '97%', duration: '1.8m', status: 'Success' },
    { task: 'Fraud detection', date: '13 Dec, 2025', accuracy: '86%', duration: '1.2m', status: 'Warning' },
    { task: 'Client data sync', date: '14 Dec, 2025', accuracy: '74%', duration: '2.8s', status: 'Failed' },
  ];

  statusTextClass(status: RowStatus): string {
    switch (status) {
      case 'Success':
        return 'text-emerald-600';
      case 'Warning':
        return 'text-orange-500';
      case 'Failed':
        return 'text-red-500';
    }
  }

  statusDotClass(status: RowStatus): string {
    switch (status) {
      case 'Success':
        return 'bg-emerald-600';
      case 'Warning':
        return 'bg-orange-500';
      case 'Failed':
        return 'bg-red-500';
    }
  }
}
