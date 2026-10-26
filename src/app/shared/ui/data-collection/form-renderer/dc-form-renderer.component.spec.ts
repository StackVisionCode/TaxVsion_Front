import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import type { FormAnswers } from '@shared/utils/data-collection/form-answers.model';
import type {
  FormComponent,
  FormDefinition,
} from '@shared/utils/data-collection/form-definition.model';
import { DcFileFieldComponent } from '../fields/dc-file-field.component';
import { DcTaxIdFieldComponent } from '../fields/dc-tax-id-field.component';
import { DcFormRendererComponent } from './dc-form-renderer.component';

const components: FormComponent[] = [
  { id: 'heading', type: 'heading', props: { text: 'Welcome', level: 2 } },
  { id: 'paragraph', type: 'paragraph', props: { text: 'Instructions' } },
  { id: 'callout', type: 'callout', props: { title: 'Note', text: 'Read this' } },
  { id: 'divider', type: 'divider' },
  { id: 'spacer', type: 'spacer', props: { size: 2 } },
  {
    id: 'consent',
    type: 'consent',
    props: {
      noticeKey: 'privacy',
      noticeVersionNumber: 1,
      mode: 'acceptance',
      acceptanceText: 'I agree',
      blocking: true,
    },
  },
  { id: 'signature', type: 'signatureStep', props: { instructions: 'Sign later' } },
  { id: 'text', type: 'text', label: 'Name' },
  { id: 'textarea', type: 'textarea', label: 'Details' },
  { id: 'number', type: 'number', label: 'Dependents' },
  { id: 'currency', type: 'currency', label: 'Income', props: { currency: 'USD' } },
  { id: 'date', type: 'date', label: 'Date' },
  { id: 'email', type: 'email', label: 'Email' },
  { id: 'phone', type: 'phone', label: 'Phone' },
  {
    id: 'select',
    type: 'select',
    label: 'Status',
    props: { options: [{ value: 'a', label: 'A' }] },
  },
  { id: 'radio', type: 'radio', label: 'Choice', props: { options: [{ value: 'a', label: 'A' }] } },
  {
    id: 'group',
    type: 'checkboxGroup',
    label: 'Choices',
    props: { options: [{ value: 'a', label: 'A' }] },
  },
  { id: 'yesno', type: 'yesNo', label: 'Confirm' },
  { id: 'checkbox', type: 'checkbox', label: 'Accept', props: { text: 'Accept' } },
  { id: 'file', type: 'file', label: 'Documents' },
  { id: 'address', type: 'address', label: 'Address' },
  { id: 'tax', type: 'taxId', label: 'Tax ID', props: { kinds: ['ssn', 'itin', 'ein'] } },
];

function definition(fields: FormComponent[] = components, repeat = false): FormDefinition {
  return {
    schemaVersion: 1,
    title: 'Client intake',
    purpose: 'clientIntake',
    presentation: 'wizard',
    settings: { showProgress: true },
    pages: [
      {
        id: 'page1',
        title: 'About you',
        sections: [
          {
            id: 'section1',
            title: 'Details',
            repeat: repeat
              ? { minRows: 0, maxRows: 3, addLabel: 'Add person', rowLabel: 'Person' }
              : null,
            components: fields,
          },
        ],
      },
    ],
  };
}

function setup(
  form = definition(),
  answers: FormAnswers = { schemaVersion: 1, values: {} },
  mode: 'fill' | 'preview' | 'readonly' = 'fill',
) {
  TestBed.configureTestingModule({ imports: [DcFormRendererComponent] });
  const fixture = TestBed.createComponent(DcFormRendererComponent);
  fixture.componentRef.setInput('definition', form);
  fixture.componentRef.setInput('answers', answers);
  fixture.componentRef.setInput('mode', mode);
  fixture.detectChanges();
  return fixture;
}

describe('DcFormRendererComponent', () => {
  it('no toca el título de la pestaña si el contenedor no lo pide (vista previa del builder)', () => {
    document.title = 'Client Forms';
    const fixture = setup(definition([{ id: 'name', type: 'text', label: 'Name' }]));
    expect(document.title).toBe('Client Forms');
    fixture.destroy();
    expect(document.title).toBe('Client Forms');
  });

  it('escribe el paso en la pestaña solo con controlsDocumentTitle y restaura el anterior al destruir', () => {
    document.title = 'Secure form';
    const fixture = setup(definition([{ id: 'name', type: 'text', label: 'Name' }]));
    fixture.componentRef.setInput('controlsDocumentTitle', true);
    fixture.detectChanges();
    expect(document.title).toBe('Step 1 of 2 - About you');
    fixture.destroy();
    expect(document.title).toBe('Secure form');
  });

  it('renderiza los 22 tipos conocidos sin caer en unsupported', () => {
    const fixture = setup();
    expect(fixture.nativeElement.querySelectorAll('app-dc-field').length).toBe(22);
    expect(fixture.nativeElement.textContent).not.toContain("This field isn't supported");
    expect(fixture.nativeElement.textContent).toContain('Electronic signature');
  });

  it('oculta y muestra campos según las condiciones', () => {
    const form = definition([
      { id: 'trigger', type: 'text', label: 'Trigger' },
      {
        id: 'dependent',
        type: 'text',
        label: 'Dependent',
        visibleWhen: { field: 'trigger', op: 'equals', value: 'yes' },
      },
    ]);
    const fixture = setup(form);
    expect(fixture.nativeElement.textContent).not.toContain('Dependent');
    const input = fixture.nativeElement.querySelector('#dc-field-trigger-root') as HTMLInputElement;
    input.value = 'yes';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Dependent');
  });

  it('aplica requiredWhen al control nativo cuando la condición se cumple', () => {
    const form = definition([
      { id: 'trigger', type: 'text', label: 'Trigger' },
      {
        id: 'dependent',
        type: 'text',
        label: 'Dependent',
        requiredWhen: { field: 'trigger', op: 'equals', value: 'yes' },
      },
    ]);
    const fixture = setup(form, { schemaVersion: 1, values: { trigger: 'yes' } });
    const dependent = fixture.nativeElement.querySelector(
      '#dc-field-dependent-root',
    ) as HTMLInputElement;
    expect(dependent.required).toBe(true);
  });

  it('muestra un fallback seguro para tipos desconocidos', () => {
    const fixture = setup(definition([{ id: 'future', type: 'futureType' }]));
    expect(fixture.nativeElement.textContent).toContain("This field isn't supported");
  });

  it('emite una copia completa de answers al cambiar un campo', () => {
    const fixture = setup(definition([{ id: 'name', type: 'text', label: 'Name' }]));
    const emitted: FormAnswers[] = [];
    fixture.componentInstance.answersChange.subscribe((value) => emitted.push(value));
    const input = fixture.nativeElement.querySelector('#dc-field-name-root') as HTMLInputElement;
    input.value = 'Ana';
    input.dispatchEvent(new Event('input'));
    expect(emitted.at(-1)).toEqual({ schemaVersion: 1, values: { name: 'Ana' } });
  });

  it('agrega y elimina filas con rowId válido', () => {
    const fixture = setup(definition([{ id: 'member', type: 'text', label: 'Member' }], true));
    const emitted: FormAnswers[] = [];
    fixture.componentInstance.answersChange.subscribe((value) => emitted.push(value));
    const add = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.includes('Add person'),
    ) as HTMLButtonElement;
    add.click();
    fixture.detectChanges();
    const rows = (emitted.at(-1)?.values['section1'] as { rows: { rowId: string }[] }).rows;
    expect(rows[0].rowId).toMatch(/^rw_[a-z0-9]{10}$/);
    const remove = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.trim() === 'Remove',
    ) as HTMLButtonElement;
    remove.click();
    fixture.detectChanges();
    const confirm = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Remove row'),
    ) as HTMLButtonElement;
    confirm.click();
    fixture.detectChanges();
    expect((emitted.at(-1)?.values['section1'] as { rows: unknown[] }).rows).toEqual([]);
  });

  it('bloquea Next con errores y abre Review al completar la página', () => {
    const fixture = setup(
      definition([{ id: 'name', type: 'text', label: 'Name', required: true }]),
    );
    const pageChanges: number[] = [];
    fixture.componentInstance.pageIndexChange.subscribe((value) => pageChanges.push(value));
    const continueButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.trim() === 'Continue',
    ) as HTMLButtonElement;
    continueButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Please review these answers');
    const input = fixture.nativeElement.querySelector('#dc-field-name-root') as HTMLInputElement;
    input.value = 'Ana';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    continueButton.click();
    fixture.detectChanges();
    expect(pageChanges).toEqual([1]);
    expect(fixture.nativeElement.textContent).toContain('Review your answers');
  });

  it('simula archivos y taxId en preview sin guardar el valor sensible', () => {
    const fixture = setup(
      definition([
        { id: 'file', type: 'file', label: 'Files' },
        { id: 'tax', type: 'taxId', label: 'Tax ID', props: { kinds: ['ssn'] } },
      ]),
      { schemaVersion: 1, values: {} },
      'preview',
    );
    const emitted: FormAnswers[] = [];
    fixture.componentInstance.answersChange.subscribe((value) => emitted.push(value));
    fixture.debugElement
      .query(By.directive(DcFileFieldComponent))
      .componentInstance.selected.emit([new File(['a'], 'proof.pdf')]);
    fixture.detectChanges();
    fixture.debugElement
      .query(By.directive(DcTaxIdFieldComponent))
      .componentInstance.entered.emit({ kind: 'ssn', value: '123-45-6789' });
    fixture.detectChanges();
    expect(JSON.stringify(emitted)).not.toContain('123456789');
    expect((emitted.at(-1)?.values['tax'] as { last4: string }).last4).toBe('6789');
    expect(fixture.nativeElement.textContent).toContain('proof.pdf');
  });
  it('espera beforePageChange y no cambia de página si devuelve false', async () => {
    const fixture = setup(definition([{ id: 'name', type: 'text', label: 'Name' }]));
    let release!: (value: boolean) => void;
    fixture.componentRef.setInput(
      'beforePageChange',
      () => new Promise<boolean>((resolve) => (release = resolve)),
    );
    const pageChanges: number[] = [];
    fixture.componentInstance.pageIndexChange.subscribe((value) => pageChanges.push(value));
    const continueButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: unknown) => (button as HTMLButtonElement).textContent?.trim() === 'Continue',
    ) as HTMLButtonElement;
    continueButton.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.navigating()).toBe(true);
    release(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(pageChanges).toEqual([]);
    expect(fixture.componentInstance.navigating()).toBe(false);
  });

  it('ofrece solo los tipos de taxId de props.kinds', () => {
    const fixture = setup(
      definition([{ id: 'tax', type: 'taxId', label: 'Tax ID', props: { kinds: ['ein'] } }]),
    );
    expect(fixture.nativeElement.querySelector('select[aria-label="Tax identifier type"]')).toBeNull();
    const emitted: unknown[] = [];
    fixture.componentInstance.sensitiveEntered.subscribe((value) => emitted.push(value));
    const input = fixture.nativeElement.querySelector('#dc-field-tax-root') as HTMLInputElement;
    input.value = '12-3456789';
    input.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([
      { componentId: 'tax', rowId: null, kind: 'ein', value: '12-3456789' },
    ]);
  });
  it('ofrece SSN e ITIN cuando el taxId no define props.kinds, igual que el validador', () => {
    const fixture = setup(definition([{ id: 'tax', type: 'taxId', label: 'Tax ID' }]));
    const options = Array.from(
      fixture.nativeElement.querySelectorAll('select[aria-label="Tax identifier type"] option'),
    ).map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(['ssn', 'itin']);
  });
});
