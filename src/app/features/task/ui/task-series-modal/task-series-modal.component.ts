import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { toApiError } from '@core/models/api-error.model';
import { TaskService } from '../../data-access/task.service';
import { ApiTaskPriority, RecurrenceMode, SeriesStatus, TaskSeriesResponse } from '../../data-access/task.model';

type FreqPreset = 'monthly' | 'quarterly' | 'yearly' | 'custom';

/**
 * Gestión de series recurrentes (F9): listar + pausar/reanudar/terminar. La CREACIÓN de series es vía
 * plantillas recurrentes (F8) — este modal administra las existentes. Las ocurrencias se trabajan como
 * tareas normales en el tablero; aquí solo se administra la regla. Una serie tiene una sola instancia
 * abierta a la vez.
 */
@Component({
  selector: 'app-task-series-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-series-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskSeriesModalComponent implements OnChanges {
  private readonly service = inject(TaskService);
  private readonly toast = inject(ToastService);

  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();

  readonly series = signal<TaskSeriesResponse[]>([]);
  readonly loading = signal(false);
  readonly busyId = signal<string | null>(null);

  /** Vista: lista de series o formulario de creación. */
  readonly view = signal<'list' | 'create'>('list');

  // ----- Constructor de serie (RRULE con presets) -----
  readonly priorities: ApiTaskPriority[] = ['Low', 'Normal', 'High', 'Urgent'];
  readonly months = [
    { v: 1, n: 'Jan' }, { v: 2, n: 'Feb' }, { v: 3, n: 'Mar' }, { v: 4, n: 'Apr' },
    { v: 5, n: 'May' }, { v: 6, n: 'Jun' }, { v: 7, n: 'Jul' }, { v: 8, n: 'Aug' },
    { v: 9, n: 'Sep' }, { v: 10, n: 'Oct' }, { v: 11, n: 'Nov' }, { v: 12, n: 'Dec' },
  ];
  readonly cTitle = signal('');
  readonly cPriority = signal<ApiTaskPriority>('Normal');
  readonly cMode = signal<RecurrenceMode>('FixedSchedule');
  readonly cStatutory = signal(false);
  readonly cAnchor = signal(this.todayIso());
  readonly cFreq = signal<FreqPreset>('monthly');
  readonly cDay = signal(15);
  readonly cMonth = signal(1);
  readonly cCustomRule = signal('');
  readonly cSaving = signal(false);
  readonly cError = signal<string | null>(null);

  /** RRULE construido a partir del preset + params (o el custom crudo). */
  readonly builtRule = computed<string>(() => {
    const day = Math.min(Math.max(this.cDay(), 1), 31);
    switch (this.cFreq()) {
      case 'monthly':
        return `FREQ=MONTHLY;BYMONTHDAY=${day}`;
      case 'quarterly':
        return `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${day}`;
      case 'yearly':
        return `FREQ=YEARLY;BYMONTH=${this.cMonth()};BYMONTHDAY=${day}`;
      case 'custom':
        return this.cCustomRule().trim();
    }
  });

  private todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.view.set('list');
      this.load();
    }
  }

  startCreate(): void {
    this.cTitle.set('');
    this.cPriority.set('Normal');
    this.cMode.set('FixedSchedule');
    this.cStatutory.set(false);
    this.cAnchor.set(this.todayIso());
    this.cFreq.set('monthly');
    this.cDay.set(15);
    this.cMonth.set(1);
    this.cCustomRule.set('');
    this.cError.set(null);
    this.view.set('create');
  }

  backToList(): void {
    this.view.set('list');
  }

  canCreate(): boolean {
    return !this.cSaving() && this.cTitle().trim().length > 0 && this.builtRule().length > 0 && !!this.cAnchor();
  }

  create(): void {
    if (!this.canCreate()) return;
    this.cSaving.set(true);
    this.cError.set(null);
    this.service
      .createSeries({
        title: this.cTitle().trim(),
        description: null,
        priority: this.cPriority(),
        customerId: null,
        taxYear: null,
        estimatedHours: null,
        assigneeUserId: null,
        isStatutory: this.cStatutory(),
        rule: this.builtRule(),
        timeZoneId: 'America/New_York',
        mode: this.cMode(),
        anchorUtc: new Date(`${this.cAnchor()}T00:00:00Z`).toISOString(),
        endsAtUtc: null,
        maxOccurrences: null,
      })
      .subscribe({
        next: created => {
          this.series.update(list => [created, ...list]);
          this.cSaving.set(false);
          this.toast.success('Series created');
          this.view.set('list');
        },
        error: err => {
          this.cSaving.set(false);
          this.cError.set(toApiError(err).message);
        },
      });
  }

  private load(): void {
    this.loading.set(true);
    this.service.listSeries().subscribe({
      next: s => {
        this.series.set(s);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  pause(s: TaskSeriesResponse): void {
    this.run(s, this.service.pauseSeries(s.id), 'Series paused');
  }

  resume(s: TaskSeriesResponse): void {
    this.run(s, this.service.resumeSeries(s.id), 'Series resumed');
  }

  end(s: TaskSeriesResponse): void {
    this.run(s, this.service.endSeries(s.id), 'Series ended');
  }

  private run(s: TaskSeriesResponse, op: Observable<TaskSeriesResponse>, okMsg: string): void {
    if (this.busyId()) return;
    this.busyId.set(s.id);
    op.subscribe({
      next: updated => {
        this.series.update(list => list.map(x => (x.id === s.id ? updated : x)));
        this.busyId.set(null);
        this.toast.success(okMsg);
      },
      error: err => {
        this.busyId.set(null);
        this.toast.error(toApiError(err).message);
      },
    });
  }

  close(): void {
    this.closed.emit();
  }

  statusColor(status: SeriesStatus): string {
    switch (status) {
      case 'Active':
        return 'bg-emerald-100 text-emerald-700';
      case 'Paused':
        return 'bg-amber-100 text-amber-700';
      case 'Ended':
        return 'bg-gray-100 text-gray-400';
    }
  }

  trackById(_i: number, s: TaskSeriesResponse): string {
    return s.id;
  }
}
