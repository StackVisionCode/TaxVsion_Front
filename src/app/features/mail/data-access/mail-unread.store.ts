import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { MailService } from './mail.service';
import { UnreadMailCount } from './mail.model';

/**
 * No leídos del correo de la oficina (hilos activos visibles para el usuario), para el badge del Inbox
 * y el del item Mail del menú. Root y perezoso: el menú lo importa tras el primer render, así que no
 * viaja en el bundle inicial. Se refresca al arrancar, con cada `mail.incoming` y cuando el store de
 * Mail cambia algo; con `mail.thread_state` (leído/archivado en otra pestaña o por otro empleado) se
 * vuelve a pedir; entre medias el store lo ajusta optimista para que el badge baje en el acto.
 */
@Injectable({ providedIn: 'root' })
export class MailUnreadStore {
  private readonly service = inject(MailService);
  private readonly realtime = inject(CommunicationRealtimeService);

  private readonly _count = signal<UnreadMailCount | null>(null);
  private started = false;
  /** Una petición a la vez: lo pedido mientras otra está en vuelo se agrupa en UNA más al terminar. */
  private inFlight = false;
  private pending = false;

  /** Conversaciones con algo sin leer (lo que muestra un cliente de correo en su badge). */
  readonly threads = computed(() => this._count()?.threads ?? 0);

  /** Idempotente: arranca la escucha de correo entrante y pide el primer conteo. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.realtime.on('mail.incoming').subscribe(() => this.refresh());
    this.realtime.on('mail.thread_state').subscribe(() => this.refresh());
    this.refresh();
  }

  /**
   * Sin cancelar la petición en curso (abortarla corta la consulta en el servidor y la deja como error en
   * sus logs): una ráfaga de eventos termina en, como mucho, una petición extra.
   */
  refresh(): void {
    if (!this.started) {
      this.start();
      return;
    }
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    this.inFlight = true;
    this.service
      .getUnreadCount()
      .pipe(catchError(() => of(null)))
      .subscribe(count => {
        // Un fallo deja el último valor conocido: mejor un badge algo viejo que uno que parpadea a 0.
        if (count) this._count.set(count);
        this.inFlight = false;
        if (this.pending) {
          this.pending = false;
          this.refresh();
        }
      });
  }

  /** Ajuste optimista (abrir, marcar, archivar); el próximo refresh trae el valor real. */
  adjustThreads(delta: number): void {
    this._count.update(count => (count ? { ...count, threads: Math.max(0, count.threads + delta) } : count));
  }
}
