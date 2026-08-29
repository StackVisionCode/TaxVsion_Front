import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  OnChanges,
  OnDestroy,
  computed,
  signal,
} from '@angular/core';
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

const COUNTER_DURATION_MS = 1100;

/**
 * Tarjeta "Used Storage" reusable (estilo "Aether"): donut de puntos
 * segmentados por categoría con el % usado animado al centro, leyenda con
 * cada categoría y su tamaño, y un bloque "Storage Type" (Upload/Download).
 * Usada tanto en la página de Storage como en el widget del Dashboard.
 * Puramente presentacional: recibe los grupos y bytes totales por @Input.
 *
 * El contador se dispara desde `ngOnChanges` y NO desde `ngOnInit`: los dos
 * consumidores montan la tarjeta con `*ngIf="!usageLoading()"`, y ese flag
 * arranca en `false`, así que en el primer render los inputs llegan vacíos
 * (`groups: []`, `totalBytes: 0`). Animar una sola vez al inicializar dejaba
 * el número congelado en el valor calculado sobre esos datos vacíos —
 * siempre "100% libre"— aunque después llegara el uso real.
 */
@Component({
  selector: 'app-used-storage-card',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './used-storage-card.component.html',
  styleUrl: './used-storage-card.component.css',
})
export class UsedStorageCardComponent implements OnChanges, OnDestroy {
  @Input() groups: UsedStorageGroup[] = [];
  @Input() totalBytes = 0;
  @Input() uploadBytes = 0;
  @Input() downloadBytes = 0;

  private readonly groupsSig = signal<UsedStorageGroup[]>([]);
  private readonly totalBytesSig = signal(0);

  private animationFrame: number | null = null;

  readonly usedBytes = computed(() => this.groupsSig().reduce((sum, group) => sum + group.sizeBytes, 0));

  /** Sin cuota conocida no se puede calcular un porcentaje: se muestra "—", no un 0 ni un 100 inventados. */
  readonly hasQuota = computed(() => this.totalBytesSig() > 0);

  /** Porcentaje usado exacto (sin redondear), o null si no hay cuota. */
  readonly usedPercent = computed<number | null>(() =>
    this.hasQuota() ? (this.usedBytes() / this.totalBytesSig()) * 100 : null,
  );

  /** Valor del contador central mientras corre la animación. */
  private readonly counter = signal(0);

  /**
   * Texto del centro: el porcentaje usado, redondeado.
   *
   * Con cuotas grandes lo normal es que dé 0 (581 KB de 200 GB), y eso se deja
   * tal cual: el dato fino ya está en el subtítulo ("X of Y used") y en la
   * leyenda por categoría, y el anillo colorea al menos un punto en cuanto hay
   * algo guardado, así que un 0 no se confunde con una cuenta vacía.
   */
  readonly displayPercent = computed<string>(() => {
    const exact = this.usedPercent();
    if (exact === null) {
      return '—';
    }
    return `${Math.round(this.counter())}`;
  });

  ngOnChanges(): void {
    this.groupsSig.set(this.groups ?? []);
    this.totalBytesSig.set(this.totalBytes > 0 ? this.totalBytes : 0);
    this.animateCounter();
  }

  ngOnDestroy(): void {
    this.cancelAnimation();
  }

  /**
   * Cuenta de 0 al % usado con easing de salida. Cancela la animación anterior
   * para que dos llegadas de datos seguidas no se pisen contando a la vez.
   * Con `prefers-reduced-motion` se salta el conteo y se fija el valor final.
   */
  private animateCounter(): void {
    this.cancelAnimation();
    const target = this.usedPercent();
    if (target === null) {
      this.counter.set(0);
      return;
    }

    const reduceMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      this.counter.set(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNTER_DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.counter.set(target * eased);
      if (progress < 1) {
        this.animationFrame = requestAnimationFrame(tick);
      } else {
        this.animationFrame = null;
      }
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private cancelAnimation(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Cuántos puntos del anillo representan espacio ocupado.
   *
   * Se fuerza un mínimo de 1 punto cuando hay algo guardado: con cuotas
   * grandes la proporción real es una fracción de punto y el anillo salía
   * entero en gris, indistinguible de una cuenta vacía.
   */
  private usedSpan(dots: number): number {
    const used = this.usedBytes();
    if (used <= 0 || !this.hasQuota()) {
      return 0;
    }
    return Math.max((used / this.totalBytesSig()) * dots, 1);
  }

  /**
   * Anillo exterior del donut: cada punto toma el color de su categoría en
   * proporción al espacio que ocupa DENTRO de lo usado; el resto (espacio
   * libre) queda en gris claro.
   */
  readonly outerDots = computed<DonutDot[]>(() => {
    const groups = this.groupsSig();
    const used = this.usedBytes();
    const span = this.usedSpan(OUTER_DOTS);
    let acc = 0;
    const thresholds =
      used > 0
        ? groups.map(group => {
            acc += group.sizeBytes;
            return { end: (acc / used) * span, color: group.color };
          })
        : [];
    return Array.from({ length: OUTER_DOTS }, (_, i) => {
      const angle = (i / OUTER_DOTS) * 2 * Math.PI - Math.PI / 2;
      const slot = thresholds.find(threshold => i + 0.5 <= threshold.end);
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
    const span = this.usedSpan(INNER_DOTS);
    return Array.from({ length: INNER_DOTS }, (_, i) => {
      const angle = (i / INNER_DOTS) * 2 * Math.PI - Math.PI / 2;
      return {
        x: DONUT_CENTER + INNER_RADIUS * Math.cos(angle),
        y: DONUT_CENTER + INNER_RADIUS * Math.sin(angle),
        r: 3,
        // El anillo interior arranca un poco después y barre a su propio ritmo.
        color: i + 0.5 <= span ? '#111827' : FREE_DOT_COLOR,
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
