import { Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { TooltipDirective } from '@shared/ui/tooltip/tooltip.directive';
import { ConnectionQuality, qualityLabel } from '../../media/media-policy.model';
import type { QualityMetrics } from '../../media/derive-quality';

/**
 * F4 (D-39) — Indicador de calidad de conexión: 3 barras con color por nivel y tooltip.
 *
 *   <app-quality-badge [quality]="connectionQuality()" [metrics]="connectionMetrics()" [showMetrics]="isStaff()" />
 *
 * - `quality` null = todavía no hay nivel: se muestra "Measuring…" (nunca "Unknown").
 * - Niveles: Excellent 3 verdes · Good 2 verdes · Fair ("Unstable" en UI) 2 ámbar · Poor 1 roja ·
 *   Disconnected 0 (rojas apagadas).
 * - `showMetrics` (solo staff): el tooltip añade RTT / pérdida / jitter / "via TURN" / capa.
 * - `size`: 'sm' (tiles, mini-player) | 'md' (overlay de llamada).
 */
@Component({
  selector: 'app-quality-badge',
  imports: [NgClass, TooltipDirective],
  host: { class: 'inline-flex' },
  template: `
    <span role="img" [attr.aria-label]="tooltip()" [appTooltip]="tooltip()"
      class="inline-flex items-end rounded-full bg-black/40 backdrop-blur-sm" [ngClass]="wrapClass()">
      @for (bar of BARS; track bar) {
        <span class="w-1 rounded-sm" [ngClass]="[barHeight(bar), bars() >= bar ? colorClass() : 'bg-white/25']"></span>
      }
    </span>
  `,
})
export class QualityBadgeComponent {
  readonly quality = input<ConnectionQuality | null>(null);
  readonly metrics = input<QualityMetrics | null>(null);
  readonly showMetrics = input(false);
  readonly size = input<'sm' | 'md'>('sm');

  protected readonly BARS = [1, 2, 3] as const;

  /** null o 'Unknown' (snapshot del servidor antes del primer reporte) = midiendo. */
  readonly measuring = computed(() => this.quality() === null || (this.quality() as string) === 'Unknown');

  protected readonly wrapClass = computed(() => [
    this.size() === 'md' ? 'gap-0.5 px-2 py-1' : 'gap-px px-1.5 py-0.5',
    this.measuring() ? 'animate-pulse motion-reduce:animate-none' : '',
  ]);

  /** Barras encendidas por nivel. */
  readonly bars = computed(() => {
    switch (this.quality()) {
      case 'Excellent':
        return 3;
      case 'Good':
      case 'Fair':
        return 2;
      case 'Poor':
        return 1;
      default:
        return 0;
    }
  });

  readonly colorClass = computed(() => {
    switch (this.quality()) {
      case 'Excellent':
      case 'Good':
        return 'bg-emerald-400';
      case 'Fair':
        return 'bg-amber-400';
      default:
        return 'bg-red-400';
    }
  });

  readonly label = computed(() => {
    const quality = this.quality();
    return quality && !this.measuring() ? `${qualityLabel(quality)} connection` : 'Measuring…';
  });

  /** Tooltip: nivel, y las cifras solo cuando `showMetrics` (staff). */
  readonly tooltip = computed(() => {
    const parts = [this.label()];
    const metrics = this.metrics();
    if (this.showMetrics() && metrics && !this.measuring()) {
      if (metrics.rttMs !== null) {
        parts.push(`RTT ${Math.round(metrics.rttMs)} ms`);
      }
      if (metrics.lossPct !== null) {
        parts.push(`Loss ${metrics.lossPct.toFixed(1)}%`);
      }
      if (metrics.jitterMs !== null) {
        parts.push(`Jitter ${Math.round(metrics.jitterMs)} ms`);
      }
      if (metrics.viaRelay) {
        parts.push('via TURN');
      }
      if (metrics.layer) {
        parts.push(`Layer ${metrics.layer}`);
      }
    }
    return parts.join(' · ');
  });

  protected barHeight(bar: number): string {
    const md = this.size() === 'md';
    return bar === 1 ? (md ? 'h-1.5' : 'h-1') : bar === 2 ? (md ? 'h-2.5' : 'h-2') : md ? 'h-3.5' : 'h-3';
  }
}
