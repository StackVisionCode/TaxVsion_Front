import { Component, Input } from '@angular/core';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import { richProp, textProp } from '../data-collection.utils';
import { DcMarkdownComponent } from '../rich-text/dc-markdown.component';

@Component({
  selector: 'app-dc-paragraph-field',
  imports: [DcMarkdownComponent],
  template: `@if (content) {
      <app-dc-markdown [document]="content" />
    } @else {
      <p class="leading-6 text-gray-700">{{ text }}</p>
    }`,
})
export class DcParagraphFieldComponent {
  @Input({ required: true }) component!: FormComponent;
  get content() {
    return richProp(this.component, 'text');
  }
  get text(): string {
    return textProp(this.component, 'text');
  }
}
