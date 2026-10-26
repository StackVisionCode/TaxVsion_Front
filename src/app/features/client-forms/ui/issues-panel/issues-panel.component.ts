import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';

@Component({
  selector: 'app-builder-issues-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (issues.length > 0) {
      <section
        class="border-t border-amber-200 bg-amber-50 px-5 py-3"
        aria-label="Validation issues"
      >
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-bold text-amber-950">
            {{ issues.length }} issue{{ issues.length === 1 ? '' : 's' }}
          </h2>
          <span class="text-xs text-amber-800">Resolve these before publishing</span>
        </div>
        <div class="mt-2 flex gap-2 overflow-x-auto pb-1">
          @for (issue of issues; track issue.code + issue.path) {
            <button
              type="button"
              class="shrink-0 rounded-full border border-amber-200 bg-white px-3 py-2 text-left text-xs text-amber-950"
              (click)="issueSelected.emit(issue)"
            >
              <strong>{{ issue.code }}</strong
              ><span class="ml-2">{{ issue.message }}</span>
            </button>
          }
        </div>
      </section>
    }
  `,
})
export class IssuesPanelComponent {
  @Input() issues: ValidationIssue[] = [];
  @Output() readonly issueSelected = new EventEmitter<ValidationIssue>();
}
