import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { linkifySegments } from '../message-text';

/**
 * F8d (T-16): texto de un mensaje con sus enlaces clicables. Abre en otra pestaña con `rel="noopener noreferrer"`
 * y solo http(s); el resto es texto plano (Angular lo escapa), nunca HTML.
 */
@Component({
  selector: 'app-linkified-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (segment of segments(); track $index) {@if (segment.kind === 'link') {<a [href]="segment.href" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 break-all" [class]="linkClass()" data-role="message-link">{{ segment.text }}</a>} @else {{{ segment.text }}}}`,
})
export class LinkifiedTextComponent {
  readonly text = input<string | null | undefined>('');
  readonly linkClass = input('');
  protected readonly segments = computed(() => linkifySegments(this.text()));
}
