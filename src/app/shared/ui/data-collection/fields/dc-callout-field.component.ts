import { Component, Input } from '@angular/core';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import { richProp, textProp } from '../data-collection.utils';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';

@Component({
  selector: 'app-dc-callout-field',
  imports: [DcMarkdownComponent],
  template: `<aside
    class="rounded-2xl border px-4 py-3"
    [class.border-amber-200]="tone === 'warning'"
    [class.bg-amber-50]="tone === 'warning'"
    [class.border-red-200]="tone === 'danger'"
    [class.bg-red-50]="tone === 'danger'"
    [class.border-sky-200]="tone !== 'warning' && tone !== 'danger'"
    [class.bg-sky-50]="tone !== 'warning' && tone !== 'danger'"
  >
    <p class="font-semibold text-gray-900">{{ title }}</p>
    @if (content) {
      <div class="mt-1 text-sm text-gray-700"><app-dc-markdown [document]="content" /></div>
    } @else if (text) {
      <p class="mt-1 text-sm text-gray-700">{{ text }}</p>
    }
  </aside>`,
})
export class DcCalloutFieldComponent {
  @Input({ required: true }) component!: FormComponent;
  get tone(): string {
    return textProp(this.component, 'tone', 'info');
  }
  get title(): string {
    return textProp(this.component, 'title', this.component.label ?? 'Information');
  }
  get content() {
    return richProp(this.component, 'text');
  }
  get text(): string {
    return textProp(this.component, 'text');
  }
}
