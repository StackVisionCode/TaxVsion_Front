import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '@shared/ui/modal/modal.component';
import { ToastService } from '@shared/ui/toast/toast.service';
import { toApiError } from '@core/models/api-error.model';
import { TaskService } from '../../data-access/task.service';
import { ApiTaskStatus, TaskLabelResponse } from '../../data-access/task.model';

/**
 * Manager de etiquetas (F11). ⚠️ Una etiqueta NO se adjunta a tareas ni filtra: **renombra un estado**
 * por tenant (cada label mapea a un `TaskItemStatus` y trae color). Es una capa de presentación — p.ej.
 * una oficina llama "En revisión" a `InProgress`. Aquí se administra el catálogo (listar/crear/borrar).
 */
@Component({
  selector: 'app-task-labels-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './task-labels-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskLabelsModalComponent implements OnChanges {
  private readonly service = inject(TaskService);
  private readonly toast = inject(ToastService);

  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();

  readonly labels = signal<TaskLabelResponse[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);

  readonly statuses: ApiTaskStatus[] = ['NotStarted', 'InProgress', 'WaitingOnClient', 'Completed', 'Cancelled'];

  // ----- Form de alta -----
  readonly newCode = signal('');
  readonly newName = signal('');
  readonly newStatus = signal<ApiTaskStatus>('InProgress');
  readonly newColor = signal('#1E466B');
  readonly addError = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetForm();
      this.load();
    }
  }

  private load(): void {
    this.loading.set(true);
    this.service.taxonomies().subscribe({
      next: tax => {
        this.labels.set(tax.labels);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  statusLabel(status: ApiTaskStatus): string {
    switch (status) {
      case 'NotStarted':
        return 'Not started';
      case 'InProgress':
        return 'In progress';
      case 'WaitingOnClient':
        return 'Waiting on client';
      case 'Completed':
        return 'Completed';
      case 'Cancelled':
        return 'Cancelled';
    }
  }

  canAdd(): boolean {
    return !this.busy() && this.newCode().trim().length > 0 && this.newName().trim().length > 0;
  }

  add(): void {
    if (!this.canAdd()) return;
    this.busy.set(true);
    this.addError.set(null);
    this.service
      .createLabel({
        code: this.newCode().trim(),
        displayName: this.newName().trim(),
        mapsToStatus: this.newStatus(),
        labelColor: this.newColor(),
      })
      .subscribe({
        next: created => {
          this.labels.update(list => [...list, created]);
          this.busy.set(false);
          this.resetForm();
          this.toast.success('Label created');
        },
        error: err => {
          this.busy.set(false);
          this.addError.set(toApiError(err).message);
        },
      });
  }

  remove(label: TaskLabelResponse): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.labels.update(list => list.filter(l => l.id !== label.id)); // optimista
    this.service.deleteLabel(label.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success('Label deleted');
      },
      error: err => {
        this.busy.set(false);
        this.load(); // reconciliar
        this.toast.error(toApiError(err).message);
      },
    });
  }

  close(): void {
    this.closed.emit();
  }

  trackById(_i: number, l: TaskLabelResponse): string {
    return l.id;
  }

  private resetForm(): void {
    this.newCode.set('');
    this.newName.set('');
    this.newStatus.set('InProgress');
    this.newColor.set('#1E466B');
    this.addError.set(null);
  }
}
