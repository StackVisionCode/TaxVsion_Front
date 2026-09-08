/** TTL por defecto: dentro de un minuto los datos siguen siendo "suficientemente frescos". */
const DEFAULT_TTL_MS = 60_000;

/**
 * Guarda de caché para stores.
 *
 * Evita el patrón que tenía la app — cada re-montaje del componente llamaba a `refresh()`
 * incondicionalmente y repetía el GET completo — sin meter una capa de caché HTTP ni tocar
 * los interceptores. Es lo que hace que volver a una sección ya visitada no vuelva a pedir
 * todo, ahora que no hay RouteReuseStrategy (ver la nota en `app.config.ts`).
 *
 * Contrato: `shouldFetch()` decide y el store SIEMPRE cierra con `settle(ok)`, tanto en
 * `next` como en `error`. Un fallo NO marca los datos como frescos, así que el siguiente
 * montaje reintenta — si no, un error de red se quedaría pegado todo el TTL sin forma de
 * recuperarse.
 *
 *     private readonly gate = new FetchGate(120_000);
 *
 *     load(clientId: string): void {
 *       if (!this.gate.shouldFetch(clientId)) return;   // mismo cliente y fresco → sin red
 *       this.service.list(clientId).subscribe({
 *         next: rows => { this._rows.set(rows); this.gate.settle(true); },
 *         error: err => { this._error.set(toApiError(err).message); this.gate.settle(false); },
 *       });
 *     }
 *
 *     // Tras crear/editar/borrar:
 *     this.gate.invalidate();
 */
export class FetchGate {
  private loadedAt = 0;
  private key: string | null = null;
  private inFlight = false;

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  /**
   * @param key   Identidad del recurso (customerId, filtro serializado…). Si cambia, siempre
   *              se va al backend. `null` para colecciones sin parámetro.
   * @param force Salta la caché (botón "Actualizar", o tras una mutación).
   */
  shouldFetch(key: string | null = null, force = false): boolean {
    if (this.inFlight) {
      // Ya hay una petición viva para esto: no se duplica. Cubre el caso de dos widgets
      // que piden la misma colección al montarse a la vez.
      return false;
    }
    if (force || key !== this.key || this.loadedAt === 0) {
      this.key = key;
      return this.open();
    }
    return Date.now() - this.loadedAt > this.ttlMs ? this.open() : false;
  }

  /** Cierra la petición. `ok = false` deja el recurso "sucio" para que se reintente. */
  settle(ok: boolean): void {
    this.inFlight = false;
    this.loadedAt = ok ? Date.now() : 0;
  }

  /** Marca los datos como obsoletos (tras una mutación) sin borrarlos de la vista. */
  invalidate(): void {
    this.loadedAt = 0;
  }

  private open(): boolean {
    this.inFlight = true;
    return true;
  }
}
