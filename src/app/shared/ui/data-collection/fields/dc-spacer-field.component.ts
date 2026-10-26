import { Component, Input } from '@angular/core';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import { intProp } from '@shared/utils/data-collection/properties';
@Component({
  selector: 'app-dc-spacer-field',
  template: `<div
    aria-hidden="true"
    [class.h-2]="size === 1"
    [class.h-4]="size === 2"
    [class.h-6]="size === 3"
    [class.h-8]="size >= 4"
  ></div>`,
})
export class DcSpacerFieldComponent {
  @Input({ required: true }) component!: FormComponent;
  get size(): number {
    return intProp(this.component.props, 'size', 2);
  }
}
