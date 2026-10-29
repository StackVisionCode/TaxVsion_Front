import { Component } from '@angular/core';
import { normalizePhone } from '@shared/utils/data-collection/formats';
import { E164_REGEX, normalizePhoneToApi } from '@shared/utils/phone.util';
import { stringProp } from '@shared/utils/data-collection/properties';
import { DcFieldBase } from './dc-field-base';
import { DcFieldShellComponent } from './dc-field-shell.component';

@Component({
  selector: 'app-dc-phone-field',
  imports: [DcFieldShellComponent],
  template: `<app-dc-field-shell
    [component]="component"
    [inputId]="inputId"
    [rowId]="rowId"
    [issues]="issues"
    [prefilled]="prefilled"
    ><input
      [id]="inputId"
      type="tel"
      inputmode="tel"
      autocomplete="tel"
      class="dc-input"
      [value]="value ?? ''"
      [required]="component.required === true"
      [attr.aria-describedby]="describedBy"
      [attr.aria-invalid]="!!errorMessage"
      [readOnly]="readonly"
      (input)="onInput($any($event.target).value)"
      (blur)="normalize()"
  /></app-dc-field-shell>`,
})
export class DcPhoneFieldComponent extends DcFieldBase<string> {
  private draft = '';
  onInput(value: string): void {
    this.draft = value;
    this.emitValue(value);
  }
  normalize(): void {
    const raw = this.draft || this.value || '';
    const strict = normalizePhoneToApi(raw);
    const normalized = E164_REGEX.test(strict)
      ? strict
      : normalizePhone(raw, stringProp(this.component.props, 'defaultCountry') ?? 'US');
    if (normalized) this.emitValue(normalized);
  }
}
