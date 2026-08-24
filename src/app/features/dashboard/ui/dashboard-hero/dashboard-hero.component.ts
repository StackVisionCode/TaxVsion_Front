import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DashboardClientsStore } from '../../data-access/dashboard-clients.store';
import { DashboardInvoicesStore, formatCents } from '../../data-access/dashboard-invoices.store';

interface HeroStat {
  title: string;
  subtitle: string;
  /** Cifra ya formateada, o "—" cuando todavía no se sabe / no está disponible. */
  value: string;
  /** Explicación de por qué no hay cifra. null cuando el dato es real. */
  note: string | null;
  bg: string;
  /** Página real a la que lleva la flecha. */
  link: string;
  linkLabel: string;
}

/** Marcador de "sin dato" — nunca un 0 ni una cifra de relleno. */
const NO_VALUE = '—';

/**
 * Zona hero del dashboard: saludo + 3 stat cards.
 *
 * Antes las tres cifras eran literales ('128' clientes, '14' facturas
 * pendientes, '$42,500' de ingresos del mes): en producción se leían como los
 * números reales de la oficina.
 *
 * Ahora las tres salen del backend:
 *  - Total clients   → `GET /customers` (totalCount exacto del servidor).
 *  - Outstanding     → `GET /billing/invoices`, facturas emitidas con saldo.
 *  - Revenue         → suma de lo cobrado en el mes en curso.
 *
 * Mientras cargan, o si el backend responde error (típicamente falta de
 * permiso `customers.view` / billing), la tarjeta muestra "—" con el motivo,
 * nunca un número inventado. Las flechas ahora llevan a la página real
 * correspondiente en vez de ser botones muertos.
 */
@Component({
  selector: 'app-dashboard-hero',
  imports: [CommonModule, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-hero.component.html',
})
export class DashboardHeroComponent implements OnInit {
  @Input() userName = '';

  private readonly clients = inject(DashboardClientsStore);
  private readonly invoices = inject(DashboardInvoicesStore);

  readonly stats = computed<HeroStat[]>(() => [
    {
      title: 'Total Clients',
      // El store pide status=All: la cifra incluye los archivados, y el subtítulo lo dice.
      subtitle: 'All clients on record',
      value: this.clientsValue(),
      note: this.noteFor(this.clients.loading(), this.clients.error()),
      bg: 'bg-[#E8F1FB]',
      link: '/clients',
      linkLabel: 'Go to clients',
    },
    {
      title: 'Outstanding Invoices',
      subtitle: 'Issued and still unpaid',
      value: this.outstandingValue(),
      note: this.noteFor(this.invoices.loading(), this.invoices.error()),
      bg: 'bg-[#CFE2F7]',
      link: '/billing',
      linkLabel: 'Go to billing',
    },
    {
      title: 'Revenue This Month',
      subtitle: 'Collected so far',
      value: this.revenueValue(),
      note: this.noteFor(this.invoices.loading(), this.invoices.error()),
      bg: 'bg-[#E7EAEE]',
      link: '/billing',
      linkLabel: 'Go to billing',
    },
  ]);

  ngOnInit(): void {
    // Ambos stores son idempotentes: si otro widget ya los cargó, no repiten la llamada.
    this.clients.load();
    this.invoices.load();
  }

  private clientsValue(): string {
    if (this.clients.loading() || this.clients.error()) {
      return NO_VALUE;
    }
    return this.clients.totalCount().toLocaleString('en-US');
  }

  private outstandingValue(): string {
    if (this.invoices.loading() || this.invoices.error()) {
      return NO_VALUE;
    }
    return this.invoices.openInvoices().length.toLocaleString('en-US');
  }

  private revenueValue(): string {
    if (this.invoices.loading() || this.invoices.error()) {
      return NO_VALUE;
    }
    return formatCents(this.invoices.collectedThisMonthCents(), this.invoices.currency());
  }

  /** Por qué la tarjeta no tiene cifra: cargando, o el error tal cual del backend. */
  private noteFor(loading: boolean, error: string | null): string | null {
    if (loading) {
      return 'Loading…';
    }
    return error;
  }
}
