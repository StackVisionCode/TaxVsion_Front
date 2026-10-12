import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AccessStore } from '@core/access/access.store';
import { AccessRequirement } from '@core/access/features';
import { CountUpDirective, formatCount } from '@shared/directives/count-up.directive';
import { SparklineComponent } from '@shared/ui/sparkline/sparkline.component';
import { DashboardInvoicesStore, formatCents } from '../../data-access/dashboard-invoices.store';
import { TaskStore } from '../../../task/data-access/task.store';
import { MeetingsService } from '../../../meetings/data-access/meetings.service';
import { MeetingStatsResponse } from '../../../meetings/data-access/meeting.model';
import { NotificationsStore } from '../../../notifications/data-access/notifications.store';
import {
  SummaryInput,
  greetingFor,
  isClearDay,
  overdueTasks,
  tasksDueOn,
  todaySummaryParts,
} from '../../utils/dashboard-insights.util';

interface HeroStat {
  title: string;
  subtitle: string;
  /** Cifra real a animar, o null cuando todavía no se sabe / no está disponible (se pinta "—"). */
  amount: number | null;
  format: (value: number) => string;
  /** Explicación de por qué no hay cifra. null cuando el dato es real. */
  note: string | null;
  bg: string;
  /** Tile focal sólido (navy): invierte el texto a blanco y la flecha a arena. */
  dark: boolean;
  /** Estado "todo en orden" (p. ej. 0 vencidas): tile salvia con check. */
  positive: boolean;
  /** % vs mes anterior. Solo donde hay historial real (Revenue); null = no se muestra. */
  delta: number | null;
  /** Serie para la mini-gráfica. null = sin gráfica. */
  series: number[] | null;
  /** Página real a la que lleva la flecha. */
  link: string;
  linkLabel: string;
  /** Qué hace falta para que la cifra exista. La tarjeta no se pinta sin eso. */
  needs: AccessRequirement;
}

const TASKS: AccessRequirement = { module: 'planner', anyOf: ['tasks.read'] };
const INVOICING: AccessRequirement = { module: null, anyOf: ['invoicing.view'] };
const MEETINGS: AccessRequirement = {
  module: 'meetings',
  anyOf: ['communication.meeting.create', 'communication.meeting.join'],
};

const CLOCK_TICK_MS = 60_000;

/**
 * Zona hero del dashboard: saludo según la hora + fecha + resumen del día enlazado, y 3 stat cards.
 *
 * Todo sale del backend y nunca se rellena con un número inventado:
 *  - Overdue tasks   → tareas del {@link TaskStore} con vencimiento ANTES de hoy (día local).
 *  - Outstanding     → `GET /billing/invoices`, facturas emitidas con saldo.
 *  - Revenue         → lo cobrado en el mes en curso, con % vs el mes anterior y la serie de 6 meses.
 *  - Resumen         → tareas que vencen hoy, `GET /communication/meetings/stats` y no leídas.
 *
 * Mientras cargan, o si el backend responde error (típicamente falta de permiso), la tarjeta muestra
 * "—" con el motivo. Outstanding y Overdue no llevan % porque no hay historial con qué compararlos.
 */
@Component({
  selector: 'app-dashboard-hero',
  imports: [CommonModule, RouterLink, CountUpDirective, SparklineComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard-hero.component.html',
  // La pastilla del % aparece con un fundido corto (solo opacidad, sin transform: R8).
  styles: `
    .delta-pill {
      transition: opacity 400ms ease 300ms;
      @starting-style {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .delta-pill { transition: none; }
    }
  `,
})
export class DashboardHeroComponent implements OnInit {
  @Input() userName = '';

  private readonly invoices = inject(DashboardInvoicesStore);
  private readonly tasks = inject(TaskStore);
  private readonly access = inject(AccessStore);
  private readonly meetingsService = inject(MeetingsService);
  private readonly notifications = inject(NotificationsStore);
  private readonly destroyRef = inject(DestroyRef);

  private readonly now = signal(new Date());
  private readonly meetingStats = signal<MeetingStatsResponse | null>(null);

  readonly greeting = computed(() => greetingFor(this.now().getHours()));
  readonly greetingIcon = computed(() => {
    const hour = this.now().getHours();
    if (hour >= 5 && hour < 12) {
      return 'sunny-outline';
    }
    return hour >= 12 && hour < 18 ? 'partly-sunny-outline' : 'moon-outline';
  });
  readonly dateLabel = computed(() =>
    this.now().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  );

  /** Las tareas son fiables solo cargadas, sin error y sin filtros de /task (el store es compartido). */
  private readonly tasksReady = computed(
    () =>
      this.access.canUse(TASKS) && !this.tasks.loading() && !this.tasks.error() && !this.tasks.isSearching(),
  );

  private readonly summaryInput = computed<SummaryInput>(() => {
    const stats = this.meetingStats();
    const unread = this.notifications.unreadCount();
    return {
      tasksDueToday: this.tasksReady() ? tasksDueOn(this.tasks.tasks(), this.now()).length : null,
      meetingsToday: stats?.today ?? null,
      liveNow: stats?.liveNow ?? null,
      unread: unread > 0 ? unread : null,
    };
  });
  readonly summary = computed(() => todaySummaryParts(this.summaryInput()));
  readonly clearDay = computed(() => isClearDay(this.summaryInput()));

  /**
   * El hero no se esconde entero aunque el usuario no tenga ninguna de las tres cifras: lleva el
   * saludo y es lo primero que se ve. Lo que se filtra son las TARJETAS, para no dejar tres "—"
   * con un error debajo que no se arregla recargando.
   */
  readonly stats = computed<HeroStat[]>(() => this.allStats().filter(stat => this.access.canUse(stat.needs)));

  readonly countFormat = formatCount;
  readonly revenueFormat = (cents: number): string => formatCents(cents, this.invoices.currency());

  private readonly allStats = computed<HeroStat[]>(() => {
    const overdue = this.overdueAmount();
    const invoicesReady = !this.invoices.loading() && !this.invoices.error();
    const allCaughtUp = overdue === 0;
    return [
      {
        title: 'Overdue Tasks',
        subtitle: allCaughtUp ? 'All caught up' : 'Past their due date',
        amount: overdue,
        format: this.countFormat,
        note: this.taskNote(),
        bg: allCaughtUp ? 'bg-sage-100' : 'bg-orange-100',
        dark: false,
        positive: allCaughtUp,
        delta: null,
        series: null,
        link: '/task',
        linkLabel: 'Go to tasks',
        needs: TASKS,
      },
      {
        title: 'Outstanding Invoices',
        subtitle: 'Issued and still unpaid',
        amount: invoicesReady ? this.invoices.openInvoices().length : null,
        format: this.countFormat,
        note: this.noteFor(this.invoices.loading(), this.invoices.error()),
        bg: 'bg-sand-100',
        dark: false,
        positive: false,
        delta: null,
        series: null,
        link: '/billing',
        linkLabel: 'Go to billing',
        needs: INVOICING,
      },
      {
        title: 'Revenue This Month',
        subtitle: 'Collected so far',
        amount: invoicesReady ? this.invoices.collectedThisMonthCents() : null,
        format: this.revenueFormat,
        note: this.noteFor(this.invoices.loading(), this.invoices.error()),
        bg: 'bg-brand-bold',
        dark: true,
        positive: false,
        delta: invoicesReady ? this.invoices.monthOverMonthPercent() : null,
        series: invoicesReady ? this.invoices.monthlyRevenue().map(bucket => bucket.paidCents) : null,
        link: '/billing',
        linkLabel: 'Go to billing',
        needs: INVOICING,
      },
    ];
  });

  ngOnInit(): void {
    // Solo lo que se va a mostrar. Los stores son idempotentes: si otro widget ya los cargó, no
    // repiten la llamada.
    if (this.access.canUse(TASKS)) {
      this.tasks.init();
    }
    if (this.access.canUse(INVOICING)) {
      this.invoices.load();
    }
    if (this.access.canUse(MEETINGS)) {
      this.meetingsService.stats().subscribe({
        next: stats => this.meetingStats.set(stats),
        error: () => undefined,
      });
    }

    // El saludo y "hoy" cambian solos si la pestaña queda abierta (mañana → tarde, medianoche).
    const timer = setInterval(() => this.now.set(new Date()), CLOCK_TICK_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  formatDelta(delta: number): string {
    return `${delta > 0 ? '+' : ''}${delta}% vs last month`;
  }

  private overdueAmount(): number | null {
    return this.tasksReady() ? overdueTasks(this.tasks.tasks(), this.now()).length : null;
  }

  private taskNote(): string | null {
    if (this.tasks.isSearching()) {
      return 'Task filters are active on the Tasks page';
    }
    return this.noteFor(this.tasks.loading(), this.tasks.error());
  }

  /** Por qué la tarjeta no tiene cifra: cargando, o el error tal cual del backend. */
  private noteFor(loading: boolean, error: string | null): string | null {
    if (loading) {
      return 'Loading…';
    }
    return error;
  }
}
