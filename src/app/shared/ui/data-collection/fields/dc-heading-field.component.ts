import { Component, Input } from '@angular/core';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import { richProp, textProp } from '../data-collection.utils';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';

@Component({
  selector: 'app-dc-heading-field',
  imports: [DcMarkdownComponent],
  template: `@if (content) {
      <app-dc-markdown [document]="content" />
    } @else if (level === 3) {
      <h3 class="text-lg font-semibold text-gray-900">{{ text }}</h3>
    } @else {
      <h2 class="text-xl font-semibold text-gray-900">{{ text }}</h2>
    }`,
})
export class DcHeadingFieldComponent {
  @Input({ required: true }) component!: FormComponent;
  get content() {
    return richProp(this.component, 'text');
  }
  get text(): string {
    return textProp(this.component, 'text', this.component.label ?? '');
  }
  get level(): number {
    return this.component.props?.['level'] === 3 ? 3 : 2;
  }
}
