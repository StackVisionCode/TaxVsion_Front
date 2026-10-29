import { TestBed } from '@angular/core/testing';
import type { FormComponent } from '@shared/utils/data-collection/form-definition.model';
import type { RichTextDocument } from '@shared/utils/data-collection/rich-text';
import { DcSignatureStepFieldComponent } from './dc-signature-step-field.component';

function render(component: FormComponent): HTMLElement {
  TestBed.configureTestingModule({ imports: [DcSignatureStepFieldComponent] });
  const fixture = TestBed.createComponent(DcSignatureStepFieldComponent);
  fixture.componentRef.setInput('component', component);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('DcSignatureStepFieldComponent (P-18)', () => {
  it('shows the read-only secure-link notice and does not capture a signature', () => {
    const el = render({ id: 's', type: 'signatureStep', props: {} });
    expect(el.textContent).toContain(
      "You'll sign this document through a secure link we'll email you.",
    );
    expect(el.querySelector('input, textarea, canvas, button')).toBeNull();
  });

  it('renders plain-string instructions above the notice', () => {
    const el = render({ id: 's', type: 'signatureStep', props: { instructions: 'Sign later' } });
    expect(el.textContent).toContain('Sign later');
  });

  it('renders RichText instructions through the markdown renderer', () => {
    const instructions: RichTextDocument = {
      type: 'doc',
      blocks: [
        { type: 'paragraph', children: [{ type: 'text', text: 'Please read before signing' }] },
      ],
    };
    const el = render({ id: 's', type: 'signatureStep', props: { instructions } });
    expect(el.querySelector('app-dc-markdown')).not.toBeNull();
    expect(el.textContent).toContain('Please read before signing');
  });
});
