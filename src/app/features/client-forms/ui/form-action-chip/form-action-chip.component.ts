import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { StatusPillComponent, type StatusTone } from '@shared/ui/status-pill/status-pill.component';
import type { FormActionRun } from '../../data-access/client-forms.model';

@Component({
  selector: 'app-form-action-chip',
  imports: [StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-center gap-2">
      <app-status-pill [tone]="tone" [soft]="true" size="xs">{{ label }}</app-status-pill>
      @if (run.canRetry) {
        <button
          type="button"
          class="text-xs font-bold text-brand-bold underline-offset-2 hover:underline"
          (click)="retried.emit(run.id)"
        >
          Retry
        </button>
      }
    </span>
  `,
})
export class FormActionChipComponent {
  @Input({ required: true }) run!: FormActionRun;
  @Output() readonly retried = new EventEmitter<string>();

  get tone(): StatusTone {
    if (this.run.status === 'Completed') return 'success';
    if (this.run.status === 'Requested') return 'info';
    if (this.run.status === 'Failed') return 'danger';
    return this.run.status === 'Rejected' ? 'warning' : 'muted';
  }

  get label(): string {
    const action = this.run.actionType;
    if (this.run.status === 'Requested') {
      if (action === 'CreateCustomer') return 'Creating client…';
      if (action === 'RequestSignature') return 'Requesting signature…';
      if (action === 'GenerateSummary') return 'Generating summary…';
      return 'Processing…';
    }
    if (this.run.status === 'Completed') {
      if (action === 'CreateCustomer') return 'Client created';
      if (action === 'RequestSignature') return 'Signed';
      if (action === 'GenerateSummary') return 'Summary ready';
      return 'Completed';
    }
    if (this.run.status === 'Rejected') {
      if (this.run.existingCustomerId) return 'Matches existing client';
      if (action === 'RequestSignature') return 'Signature declined';
      return 'Action rejected';
    }
    if (this.run.status === 'Failed') {
      if (action === 'CreateCustomer') return "Couldn't create client";
      return 'Action failed';
    }
    return 'Skipped';
  }
}
