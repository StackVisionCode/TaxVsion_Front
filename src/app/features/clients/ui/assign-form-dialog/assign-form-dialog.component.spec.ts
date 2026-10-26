import { TestBed } from '@angular/core/testing';
import type { AssignableClientFormTemplate } from '../../data-access/client-forms.model';
import { AssignFormDialogComponent } from './assign-form-dialog.component';

const template = (templateId: string): AssignableClientFormTemplate =>
  ({ templateId, name: templateId, latestVersionNumber: 1 }) as AssignableClientFormTemplate;

describe('AssignFormDialogComponent initial template', () => {
  function create() {
    const fixture = TestBed.createComponent(AssignFormDialogComponent);
    return { fixture, component: fixture.componentInstance };
  }

  it('preselects the initial template once it is in the list, even if the list arrives later', () => {
    const { fixture, component } = create();
    fixture.componentRef.setInput('initialTemplateId', 'template-2');
    expect(component.templateId()).toBe('');

    fixture.componentRef.setInput('templates', [template('template-1'), template('template-2')]);

    expect(component.templateId()).toBe('template-2');
  });

  it('does not preselect a template that is not assignable', () => {
    const { fixture, component } = create();
    fixture.componentRef.setInput('templates', [template('template-1')]);
    fixture.componentRef.setInput('initialTemplateId', 'archived-template');

    expect(component.templateId()).toBe('');
  });

  it('shows the placeholder as selected when no template is chosen', () => {
    const { fixture } = create();
    fixture.componentRef.setInput('templates', [template('template-1')]);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[0].selected).toBe(true);
    fixture.destroy();
  });
});
