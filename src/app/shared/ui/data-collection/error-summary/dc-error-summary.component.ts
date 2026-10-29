import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import type { ValidationIssue } from '@shared/utils/data-collection/validation';
import { fieldDomId } from '../data-collection.utils';

/** Resumen accesible de errores con enlaces a cada control. */
@Component({
  selector: 'app-dc-error-summary',
  template: `@if (issues.length > 0) {
    <section
      #summary
      tabindex="-1"
      class="rounded-2xl border border-red-300 bg-red-50 p-4"
      role="alert"
      aria-labelledby="dc-error-summary-title"
    >
      <h2 id="dc-error-summary-title" class="font-semibold text-red-900">
        Please review these answers
      </h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        @for (issue of issues; track issue.path + (issue.rowId ?? '')) {
          <li>
            <a
              class="text-sm font-medium text-red-800 underline underline-offset-2"
              [href]="target(issue)"
              (click)="focusField(issue, $event)"
              >{{ issue.message }}</a
            >
          </li>
        }
      </ul>
    </section>
  }`,
})
export class DcErrorSummaryComponent {
  @Input() issues: readonly ValidationIssue[] = [];
  @ViewChild('summary') private summary?: ElementRef<HTMLElement>;

  focus(): void {
    this.summary?.nativeElement.focus();
  }
  target(issue: ValidationIssue): string {
    return `#${fieldDomId(issue.componentId ?? 'form', issue.rowId ?? null)}`;
  }
  focusField(issue: ValidationIssue, event: Event): void {
    event.preventDefault();
    const target = document.getElementById(
      fieldDomId(issue.componentId ?? 'form', issue.rowId ?? null),
    );
    (target ?? document.querySelector<HTMLElement>('[data-dc-page-heading]'))?.focus();
  }
}
