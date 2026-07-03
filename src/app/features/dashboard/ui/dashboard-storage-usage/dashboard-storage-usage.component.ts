import { Component, CUSTOM_ELEMENTS_SCHEMA, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

/**
 * Static placeholder storage summary for the "Storage Overview" widget. No
 * inputs required — a realistic used/total byte pair is baked into the
 * component so the usage ring and progress figures render fully populated.
 * `loadData()` only replays a short local spinner animation; it is not wired
 * to a backend yet.
 */
interface StorageSummary {
  usedBytes: number;
  maxBytes: number;
  customerUsedBytes: number;
  companyOwnUsedBytes: number;
  totalCustomers: number;
  totalFiles: number;
}

const GB = 1024 * 1024 * 1024;

@Component({
  selector: 'app-dashboard-storage-usage',
  imports: [CommonModule, RouterModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-storage-usage.component.html',
  styleUrl: './dashboard-storage-usage.component.scss',
})
export class DashboardStorageUsageComponent {
  readonly loading = signal(false);

  readonly summary = signal<StorageSummary>({
    usedBytes: 42.3 * GB,
    maxBytes: 100 * GB,
    companyOwnUsedBytes: 18.7 * GB,
    customerUsedBytes: 23.6 * GB,
    totalCustomers: 86,
    totalFiles: 1284,
  });

  readonly isUnlimitedPlan = computed(() => this.summary().maxBytes <= 0);

  readonly usagePercent = computed(() => {
    const s = this.summary();
    if (this.isUnlimitedPlan() || s.maxBytes <= 0) return 0;
    return Math.min(100, (s.usedBytes / s.maxBytes) * 100);
  });

  readonly customerPercent = computed(() => {
    const s = this.summary();
    if (this.isUnlimitedPlan() || s.maxBytes <= 0) return 0;
    return (s.customerUsedBytes / s.maxBytes) * 100;
  });

  readonly companyPercent = computed(() => {
    const s = this.summary();
    if (this.isUnlimitedPlan() || s.maxBytes <= 0) return 0;
    return (s.companyOwnUsedBytes / s.maxBytes) * 100;
  });

  loadData(): void {
    // Purely cosmetic — no backend call yet, just replays the spinner briefly.
    this.loading.set(true);
    setTimeout(() => this.loading.set(false), 600);
  }

  formatFreeSpace(): string {
    const s = this.summary();
    return this.formatBytes(Math.max(0, s.maxBytes - s.usedBytes));
  }

  formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }

  getUsageColor(): string {
    if (this.isUnlimitedPlan()) return 'text-emerald-600';
    const pct = this.usagePercent();
    if (pct >= 90) return 'text-red-600';
    if (pct >= 75) return 'text-amber-600';
    return 'text-emerald-600';
  }
}
