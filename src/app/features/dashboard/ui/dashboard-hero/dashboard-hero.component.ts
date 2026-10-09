import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { DashboardInvoicesStore, formatCents } from '../../data-access/dashboard-invoices.store';
import { TaskStore } from '../../../task/data-access/task.store';

interface HeroStat {
  title: string;
  subtitle: string;
  /** Cifra ya formateada, o "—" cuando todavía no se sabe / no está disponible. */
  value: string;
  /** Explicación de por qué no hay cifra. null cuando el dato es real. */
  note: string | null;
  bg: string;
  /** Tile focal sólido (navy): invierte el texto a blanco y la flecha a arena. */
  dark: boolean;
  /** Página real a la que lleva la flecha. */
  link: string;
  linkLabel: string;
  /** Qué hace falta para que la cifra exista. La tarjeta no se pinta sin eso. */
  needs: AccessRequirement;
}

const TASKS: AccessRequirement = { module: 'planner', anyOf: ['tasks.read'] };
const INVOICING: AccessRequirement = { module: null, anyOf: ['invoicing.view'] };

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
 *  - Overdue tasks   → tareas del {@link TaskStore} con vencimiento pasado.
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

  private readonly invoices = inject(DashboardInvoicesStore);
  private readonly tasks = inject(TaskStore);
  private readonly access = inject(AccessStore);

  /**
   * El hero no se esconde entero aunque el usuario no tenga ninguna de las tres cifras: lleva el
   * saludo y es lo primero que se ve. Lo que se filtra son las TARJETAS, para no dejar tres "—"
   * con un error debajo que no se arregla recargando.
   */
  readonly stats = computed<HeroStat[]>(() => this.allStats().filter(stat => this.access.canUse(stat.needs)));

  private readonly allStats = computed<HeroStat[]>(() => [
    {
      title: 'Overdue Tasks',
      subtitle: 'Past their due date',
      value: this.overdueValue(),
      note: this.noteFor(this.tasks.loading(), this.tasks.error()),
      bg: 'bg-orange-100',
      dark: false,
      link: '/task',
      linkLabel: 'Go to tasks',
      needs: TASKS,
    },
    {
      title: 'Outstanding Invoices',
      subtitle: 'Issued and still unpaid',
      value: this.outstandingValue(),
      note: this.noteFor(this.invoices.loading(), this.invoices.error()),
      bg: 'bg-sand-100',
      dark: false,
      link: '/billing',
      linkLabel: 'Go to billing',
      needs: INVOICING,
    },
    {
      title: 'Revenue This Month',
      subtitle: 'Collected so far',
      value: this.revenueValue(),
      note: this.noteFor(this.invoices.loading(), this.invoices.error()),
      bg: 'bg-brand-bold',
      dark: true,
      link: '/billing',
      linkLabel: 'Go to billing',
      needs: INVOICING,
    },
  ]);

  ngOnInit(): void {
    // Solo lo que se va a mostrar. Los stores son idempotentes: si otro widget ya los cargó, no
    // repiten la llamada.
    if (this.access.canUse(TASKS)) {
      this.tasks.init();
    }
    if (this.access.canUse(INVOICING)) {
      this.invoices.load();
    }
  }

  /**
   * Vencidas = con fecha de vencimiento ANTERIOR a hoy y todavía abiertas.
   *
   * `dueDate` ya viene como 'YYYY-MM-DD' en UTC, así que se compara como texto
   * contra el día UTC de hoy: es exacto y evita que el huso del navegador
   * adelante o atrase el corte un día. Lo que vence hoy no cuenta como vencido.
   */
  private overdueValue(): string {
    if (this.tasks.loading() || this.tasks.error()) {
      return NO_VALUE;
    }
    const today = new Date().toISOString().slice(0, 10);
    const overdue = this.tasks
      .tasks()
      .filter(
        task =>
          !!task.dueDate &&
          task.dueDate < today &&
          task.apiStatus !== 'Completed' &&
          task.apiStatus !== 'Cancelled',
      );
    return overdue.length.toLocaleString('en-US');
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
