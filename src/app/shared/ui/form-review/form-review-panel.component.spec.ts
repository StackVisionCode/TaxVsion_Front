import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormDefinition } from '@shared/utils/data-collection/form-definition.model';
import { FormReviewPanelComponent, type FormReviewRevision } from './form-review-panel.component';

const definition: FormDefinition = {
  schemaVersion: 1,
  title: 'Intake',
  purpose: 'clientIntake',
  presentation: 'singlePage',
  pages: [
    {
      id: 'page',
      sections: [
        {
          id: 'section',
          components: [
            { id: 'tax', type: 'taxId', label: 'SSN' },
            { id: 'home', type: 'address', label: 'Home address' },
            { id: 'docs', type: 'file', label: 'W-2' },
            { id: 'married', type: 'yesNo', label: 'Married' },
          ],
        },
      ],
    },
  ],
};

const sensitiveRef = 'f28627e6-8e3d-4ee5-a63d-a09abb066d2a';
const previous: FormReviewRevision = {
  number: 1,
  fieldComments: [],
  answers: {
    schemaVersion: 1,
    values: {
      tax: { sensitiveRef: 'a1e2c3d4-0000-4000-8000-000000000001', last4: '1111', kind: 'ssn' },
      home: { line1: '1 Old Rd', city: 'Austin', state: 'TX', postalCode: '78701' },
      married: false,
    },
  },
};
const current: FormReviewRevision = {
  number: 2,
  fieldComments: [],
  answers: {
    schemaVersion: 1,
    values: {
      tax: { sensitiveRef, last4: '6789', kind: 'ssn' },
      home: { line1: '9 New St', line2: 'Apt 4', city: 'Dallas', state: 'TX', postalCode: '75201' },
      docs: [{ fileId: '0b6b1d39-1f0c-4f55-9a54-7d3c2b1a0e11' }],
      married: true,
    },
  },
};

async function setup() {
  await TestBed.configureTestingModule({ imports: [FormReviewPanelComponent] }).compileComponents();
  const fixture = TestBed.createComponent(FormReviewPanelComponent);
  const reveal = vi.fn(async () => '123-45-6789');
  fixture.componentRef.setInput('requestId', 'request-1');
  fixture.componentRef.setInput('definition', definition);
  fixture.componentRef.setInput('revision', current);
  fixture.componentRef.setInput('previousRevision', previous);
  fixture.componentRef.setInput('attachments', [
    {
      id: 'att-1',
      fileId: '0b6b1d39-1f0c-4f55-9a54-7d3c2b1a0e11',
      componentId: 'docs',
      displayName: 'w2-2025.pdf',
      status: 'Available',
    },
  ]);
  fixture.componentRef.setInput('canReveal', true);
  fixture.componentRef.setInput('revealValue', reveal);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, reveal };
}

const taxEntry = {
  component: { id: 'tax', type: 'taxId' },
  rowId: null,
  value: { sensitiveRef, last4: '6789', kind: 'ssn' },
};

async function revealTax(fixture: ComponentFixture<FormReviewPanelComponent>) {
  fixture.componentInstance.confirmReveal(taxEntry);
  await fixture.componentInstance.revealConfirmed();
}

describe('FormReviewPanelComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('uses a staff heading in Answers instead of the client review copy', async () => {
    const { fixture } = await setup();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Submitted answers');
    expect(text).not.toContain('Review your answers');
    expect(text).not.toContain('Check each answer before submitting.');
  });

  it('shows readable values in Changes and never the raw JSON or sensitiveRef', async () => {
    const { fixture } = await setup();
    fixture.componentInstance.tab.set('changes');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('•••-••-1111');
    expect(text).toContain('•••-••-6789');
    expect(text).toContain('1 Old Rd, Austin, TX 78701');
    expect(text).toContain('9 New St, Apt 4, Dallas, TX 75201');
    expect(text).toContain('w2-2025.pdf');
    expect(text).toContain('Yes');
    expect(text).not.toContain(sensitiveRef);
    expect(text).not.toContain('sensitiveRef');
    expect(text).not.toContain('{');
  });

  it('asks for confirmation and hides the revealed value after thirty seconds', async () => {
    vi.useFakeTimers();
    const { fixture, component, reveal } = await setup();
    component.confirmReveal(taxEntry);
    expect(component.revealTarget()).not.toBeNull();
    expect(reveal).not.toHaveBeenCalled();
    await component.revealConfirmed();

    expect(reveal).toHaveBeenCalledWith(sensitiveRef);
    expect(component.revealedFor(taxEntry)).toBe('123-45-6789');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(component.revealedFor(taxEntry)).toBeNull();
    fixture.destroy();
  });

  it('hides the revealed value when the revision changes', async () => {
    const { fixture, component } = await setup();
    await revealTax(fixture);
    expect(component.revealedFor(taxEntry)).toBe('123-45-6789');
    fixture.componentRef.setInput('revision', { ...previous });
    fixture.detectChanges();
    expect(component.revealedFor(taxEntry)).toBeNull();
  });

  it('hides the revealed value when the permission is lost or the panel is destroyed', async () => {
    const { fixture, component } = await setup();
    await revealTax(fixture);
    fixture.componentRef.setInput('canReveal', false);
    expect(component.revealedFor(taxEntry)).toBeNull();

    fixture.componentRef.setInput('canReveal', true);
    await revealTax(fixture);
    expect(component.revealedFor(taxEntry)).toBe('123-45-6789');
    fixture.destroy();
    expect(component.revealed()).toBeNull();
  });
});
