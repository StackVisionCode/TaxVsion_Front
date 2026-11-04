import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, concat, of, switchMap, take, takeWhile, timer } from 'rxjs';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { StatusPillComponent, StatusTone } from '@shared/ui/status-pill/status-pill.component';
import { parseUtcDateOrNull } from '@shared/utils/utc-date.util';
import { OffboardImpactService } from '../../data-access/offboard-impact.service';
import { OffboardingStatus, offboardingReasonLabel } from '../../data-access/user-management.model';

/** Cada cuánto se vuelve a preguntar mientras las áreas confirman, y hasta cuántas veces (≈1 min). */
const POLL_EVERY_MS = 3000;
const MAX_POLLS = 20;

type LoadState = 'loading' | 'ready' | 'untracked' | 'error';

/**
 * Avance del handover de alguien ya desvinculado: cuántas áreas confirmaron su parte y cuáles faltan (por
 * nombre de área, nunca de servicio). Mientras está en curso se refresca solo un rato; un retiro anterior al
 * seguimiento (404) se explica en vez de mostrarse como error.
 */
@Component({
  selector: 'app-offboard-status-dialog',
  imports: [CommonModule, ModalComponent, StatusPillComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './offboard-status-dialog.component.html',
})
export class OffboardStatusDialogComponent implements OnInit {
  private readonly service = inject(OffboardImpactService);
  private readonly destroyRef = inject(DestroyRef);
  private polling?: Subscription;

  @Input({ required: true }) userId!: string;
  @Input() name = '';
  @Output() closed = new EventEmitter<void>();
  /** Intervalo del refresco mientras está en curso (los tests lo acortan). */
  pollEveryMs = POLL_EVERY_MS;

  readonly state = signal<LoadState>('loading');
  readonly status = signal<OffboardingStatus | null>(null);

  /** Áreas pendientes sin repetir (un área puede tener varios pasos). */
  readonly pendingAreas = computed(() => [...new Set((this.status()?.pending ?? []).map(step => step.module))]);

  /** Auth manda las fechas sin la `Z`: se leen como UTC para mostrarlas en la hora local de quien mira. */
  readonly startedAt = computed(() => parseUtcDateOrNull(this.status()?.startedAtUtc));
  readonly completedAt = computed(() => parseUtcDateOrNull(this.status()?.completedAtUtc));

  readonly percent = computed(() => {
    const current = this.status();
    return current && current.expected > 0 ? Math.round((current.completed / current.expected) * 100) : 0;
  });

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.polling?.unsubscribe();
    // Primera consulta al instante; después, cada `pollEveryMs` mientras siga en curso.
    this.polling = concat(of(0), timer(this.pollEveryMs, this.pollEveryMs))
      .pipe(
        take(MAX_POLLS),
        switchMap(() =>
          this.service.getStatus(this.userId).pipe(
            catchError((error: unknown) => {
              this.state.set(error instanceof HttpErrorResponse && error.status === 404 ? 'untracked' : 'error');
              return of(null);
            }),
          ),
        ),
        // Sigue solo mientras esté en curso; el último valor (terminado o fallido) también se emite.
        takeWhile(current => current?.status === 'InProgress', true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(current => {
        if (current) {
          this.status.set(current);
          this.state.set('ready');
        }
      });
  }

  reasonLabel(current: OffboardingStatus): string | null {
    return offboardingReasonLabel(current.reason);
  }

  statusLabel(current: OffboardingStatus): string {
    switch (current.status) {
      case 'Completed':
        return 'Handover complete';
      case 'Incomplete':
        return 'Needs attention';
      default:
        return 'In progress';
    }
  }

  statusTone(current: OffboardingStatus): StatusTone {
    switch (current.status) {
      case 'Completed':
        return 'success';
      case 'Incomplete':
        return 'warning';
      default:
        return 'info';
    }
  }
}
