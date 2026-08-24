import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClientProfile } from '../../models/client-profile.model';

interface OverviewStat {
  title: string;
  subtitle: string;
  /** `null` = no hay dato real detrás; la tarjeta pinta "—" en vez de una cifra inventada. */
  value: string | null;
  bg: string;
}

/**
 * Tab "Overview" del perfil de cliente.
 *
 * Solo se muestra lo que sale del cliente REAL (GET /customers/{id}): "Client since" se
 * deriva de `createdAt`. El resto de las tarjetas quedan en "—" y el timeline de
 * actividad reciente se retiró, porque ninguna de esas cifras tiene fuente:
 *
 *  - "Open invoices": `GET /billing/invoices` solo acepta `take` y su fila
 *    (`InvoiceSummaryResponse`) no expone el customer, así que no hay forma de contar las
 *    facturas de ESTE cliente (mismo bloqueo que la pestaña Invoices).
 *  - "Documents on file": CloudStorage no ofrece un listado filtrable por cliente
 *    (`GET /storage/files` solo acepta `skip`/`take`), así que no hay un total fiable.
 *  - "Last activity" / "Recent activity": no existe un feed de actividad por cliente en
 *    ningún servicio; habría que agregar varios servicios distintos, y hoy la mayoría ni
 *    siquiera sabe a qué customer pertenece cada hecho.
 *
 * Antes esto pintaba literales fijos ("2" facturas abiertas, "8" documentos, "3 days
 * ago") y un timeline inventado (Invoice #INV-2026-0141 sent, W-2 2025 uploaded…) bajo el
 * nombre de un cliente REAL. Se retiró por completo.
 */
@Component({
  selector: 'app-client-profile-overview',
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './client-profile-overview.component.html',
})
export class ClientProfileOverviewComponent {
  @Input() client!: ClientProfile;

  stats(): OverviewStat[] {
    return [
      {
        title: 'Client since',
        subtitle: 'Relationship length',
        value: this.clientSince(),
        bg: 'bg-[#E8F1FB]',
      },
      { title: 'Open invoices', subtitle: 'Not available yet', value: null, bg: 'bg-[#CFE2F7]' },
      { title: 'Documents on file', subtitle: 'Not available yet', value: null, bg: 'bg-[#E7EAEE]' },
      { title: 'Last activity', subtitle: 'Not available yet', value: null, bg: 'bg-[#DDE9F5]' },
    ];
  }

  /** Único dato real de esta pantalla: se deriva del `createdAt` del cliente. */
  private clientSince(): string {
    const created = new Date(`${this.client.createdAt}T00:00:00`);
    const now = new Date();
    let months = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
    if (now.getDate() < created.getDate()) {
      months -= 1;
    }
    months = Math.max(0, months);

    if (months < 12) {
      return `${months} ${months === 1 ? 'month' : 'months'}`;
    }
    const years = Math.floor(months / 12);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }
}
