import { Component, Input } from '@angular/core';
@Component({
  selector: 'app-dc-unsupported-field',
  template: `<div
    class="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
    role="status"
  >
    This field isn't supported. <span class="font-mono text-xs">{{ type }}</span>
  </div>`,
})
export class DcUnsupportedFieldComponent {
  @Input() type = '';
}
