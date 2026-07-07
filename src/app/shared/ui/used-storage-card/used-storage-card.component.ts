import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnChanges, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface UsedStorageGroup {
  name: string;
  /** Color sólido (hex) compartido por el punto de la leyenda y el donut. */
  color: string;
  sizeBytes: number;
}

/** Punto del anillo del donut, precalculado para mantener el SVG del template simple. */
interface DonutDot {
  x: number;
  y: number;
  r: number;
  color: string;
  /** Retraso de la animación de entrada: los puntos barren el anillo en sentido horario. */
  delay: string;
}

const GB = 1024 ** 3;

/** Cuántos puntos forman cada anillo del donut. */
const OUTER_DOTS = 44;
const INNER_DOTS = 30;
/** Centro y radios del SVG del donut (viewBox 180x180). */
const DONUT_CENTER = 90;
const OUTER_RADIUS = 76;
const INNER_RADIUS = 58;
/** Color de los puntos que representan espacio libre. */
const FREE_DOT_COLOR = '#EBE9F2';

/**
 * Tarjeta "Used Storage" reusable (estilo "Aether"): donut de puntos
 * segmentados por categoría con el % libre animado al centro, leyenda con
 * cada categoría y su tamaño, y un bloque "Storage Type" (Upload/Download).
 * Usada tanto en la página de Storage como en el widget del Dashboard, así
 * el diseño y la animación de entrada quedan idénticos en los dos lugares.
 * Puramente presentacional: recibe los grupos y bytes totales por @Input.
 */
@Component({
  selector: 'app-used-storage-card',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './used-storage-card.component.html',
  styleUrl: './used-storage-card.component.css',
})
export class UsedStorageCardComponent implements OnInit, OnChanges {
  @Input() groups: UsedStorageGroup[] = [];
  @Input() totalBytes = 100 * GB;
  @Input() uploadBytes = 0;
  @Input() downloadBytes = 0;

  private readonly groupsSig = signal<UsedStorageGroup[]>([]);
  private readonly totalBytesSig = signal(100 * GB);

  ngOnChanges(): void {
    this.groupsSig.set(this.groups);
    this.totalBytesSig.set(this.totalBytes || 100 * GB);
  }

  readonly usedBytes = computed(() => this.groupsSig().reduce((sum, group) => sum + group.sizeBytes, 0));

  readonly freePercent = computed(() =>
    Math.round(((this.totalBytesSig() - this.usedBytes()) / this.totalBytesSig()) * 100),
  );

  /** Porcentaje mostrado en el centro: cuenta de 0 al valor real durante la entrada. */
  readonly displayPercent = signal(0);

  /** Anima el contador central de 0 al % libre con easing de salida (~1.1s). */
  ngOnInit(): void {
    const target = this.freePercent();
    const durationMs = 1100;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.displayPercent.set(Math.round(target * eased));
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }

  /**
   * Anillo exterior del donut: cada punto toma el color de su categoría en
   * proporción al espacio que ocupa dentro del total; el resto (espacio
   * libre) queda en gris claro.
   */
  readonly outerDots = computed<DonutDot[]>(() => {
    const groups = this.groupsSig();
    const total = this.totalBytesSig();
    let acc = 0;
    const thresholds = groups.map(group => {
      acc += group.sizeBytes;
      return { end: (acc / total) * OUTER_DOTS, color: group.color };
    });
    return Array.from({ length: OUTER_DOTS }, (_, i) => {
      const angle = (i / OUTER_DOTS) * 2 * Math.PI - Math.PI / 2;
      const slot = thresholds.find(t => i + 0.5 <= t.end);
      return {
        x: DONUT_CENTER + OUTER_RADIUS * Math.cos(angle),
        y: DONUT_CENTER + OUTER_RADIUS * Math.sin(angle),
        r: 5,
        color: slot?.color ?? FREE_DOT_COLOR,
        delay: `${i * 20}ms`,
      };
    });
  });

  /** Anillo interior decorativo: puntos oscuros hasta el % usado, claros el resto. */
  readonly innerDots = computed<DonutDot[]>(() => {
    const usedDots = (this.usedBytes() / this.totalBytesSig()) * INNER_DOTS;
    return Array.from({ length: INNER_DOTS }, (_, i) => {
      const angle = (i / INNER_DOTS) * 2 * Math.PI - Math.PI / 2;
      return {
        x: DONUT_CENTER + INNER_RADIUS * Math.cos(angle),
        y: DONUT_CENTER + INNER_RADIUS * Math.sin(angle),
        r: 3,
        // El anillo interior arranca un poco después y barre a su propio ritmo.
        color: i + 0.5 <= usedDots ? '#111827' : FREE_DOT_COLOR,
        delay: `${180 + i * 26}ms`,
      };
    });
  });

  formatBytes(bytes: number): string {
    if (bytes <= 0) {
      return '0 KB';
    }
    if (bytes >= GB) {
      return `${(bytes / GB).toFixed(1)} GB`;
    }
    if (bytes >= 1024 ** 2) {
      return `${Math.round(bytes / 1024 ** 2)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
}
