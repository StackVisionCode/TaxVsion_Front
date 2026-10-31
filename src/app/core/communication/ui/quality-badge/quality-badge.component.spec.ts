import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { QualityBadgeComponent } from './quality-badge.component';
import type { ConnectionQuality } from '../../media/media-policy.model';
import type { QualityMetrics } from '../../media/derive-quality';

@Component({
  imports: [QualityBadgeComponent],
  template: `<app-quality-badge [quality]="quality()" [metrics]="metrics()" [showMetrics]="staff()" />`,
})
class HostComponent {
  readonly quality = signal<ConnectionQuality | null>(null);
  readonly metrics = signal<QualityMetrics | null>(null);
  readonly staff = signal(false);
}

const METRICS: QualityMetrics = {
  rttMs: 120.4,
  lossPct: 1.25,
  jitterMs: 20,
  viaRelay: true,
  inKbps: 300,
  outKbps: 200,
  fps: 30,
  layer: 'r2',
  packetsReceivedDelta: 10,
  packetsReceivedTotal: 100,
};

function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const badge = () => fixture.nativeElement.querySelector('[role="img"]') as HTMLElement;
  const litBars = () => badge().querySelectorAll('span.bg-emerald-400, span.bg-amber-400, span.bg-red-400').length;
  return { fixture, host: fixture.componentInstance, badge, litBars };
}

describe('QualityBadgeComponent', () => {
  it('sin nivel muestra "Measuring…" (nunca "Unknown") con las barras apagadas', () => {
    const { badge, litBars } = setup();
    expect(badge().getAttribute('aria-label')).toBe('Measuring…');
    expect(litBars()).toBe(0);
  });

  it('enciende barras por nivel y traduce Fair a "Unstable"', () => {
    const { fixture, host, badge, litBars } = setup();
    const cases: [ConnectionQuality, number, string][] = [
      ['Excellent', 3, 'bg-emerald-400'],
      ['Good', 2, 'bg-emerald-400'],
      ['Fair', 2, 'bg-amber-400'],
      ['Poor', 1, 'bg-red-400'],
      ['Disconnected', 0, 'bg-red-400'],
    ];
    for (const [quality, bars, color] of cases) {
      host.quality.set(quality);
      fixture.detectChanges();
      expect(litBars(), quality).toBe(bars);
      if (bars > 0) {
        expect(badge().querySelector(`span.${color}`), quality).not.toBeNull();
      }
    }
    host.quality.set('Fair');
    fixture.detectChanges();
    expect(badge().getAttribute('aria-label')).toBe('Unstable connection');
  });

  it('las cifras (RTT, pérdida, jitter, TURN, capa) solo aparecen con showMetrics', () => {
    const { fixture, host, badge } = setup();
    host.quality.set('Good');
    host.metrics.set(METRICS);
    fixture.detectChanges();
    expect(badge().getAttribute('aria-label')).toBe('Good connection');

    host.staff.set(true);
    fixture.detectChanges();
    expect(badge().getAttribute('aria-label')).toBe('Good connection · RTT 120 ms · Loss 1.3% · Jitter 20 ms · via TURN · Layer r2');
  });
});
