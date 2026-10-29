import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  FormReviewActionDialogComponent,
  type FormReviewActionResult,
} from './form-review-action-dialog.component';

function setup(kind: 'return' | 'archive') {
  TestBed.configureTestingModule({ imports: [FormReviewActionDialogComponent] });
  const fixture = TestBed.createComponent(FormReviewActionDialogComponent);
  const emitted: FormReviewActionResult[] = [];
  fixture.componentInstance.confirmed.subscribe((value) => emitted.push(value));
  fixture.componentRef.setInput('kind', kind);
  fixture.detectChanges();
  return { fixture, emitted };
}

// El modal se porta al body: se consulta el documento.
function confirmButton(): HTMLButtonElement {
  return Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Confirm',
  ) as HTMLButtonElement;
}

describe('FormReviewActionDialogComponent', () => {
  it('explains that the message is required instead of ignoring Confirm', () => {
    const { fixture, emitted } = setup('return');

    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();
    fixture.detectChanges();

    expect(emitted).toEqual([]);
    expect(document.body.textContent).toContain(
      'Write a message so the client knows what to change.',
    );
    expect(document.querySelector('textarea')?.getAttribute('aria-invalid')).toBe('true');
    fixture.destroy();
  });

  it('sends the trimmed message once it is written', () => {
    const { fixture, emitted } = setup('return');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;

    textarea.value = '  Please upload the W-2  ';
    textarea.dispatchEvent(new Event('input'));
    confirmButton().click();

    expect(emitted).toEqual([{ kind: 'return', note: 'Please upload the W-2', dueAtUtc: null }]);
    expect(textarea.maxLength).toBe(2000);
    fixture.destroy();
  });

  it('shows the action error inside the dialog', () => {
    const { fixture } = setup('archive');

    fixture.componentRef.setInput('error', 'This request can no longer be changed.');
    fixture.detectChanges();

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'This request can no longer be changed.',
    );
    fixture.destroy();
  });

  it('announces the missing message and links the due date hint to its input', () => {
    const { fixture } = setup('return');
    confirmButton().click();
    fixture.detectChanges();
    expect(document.querySelector('#form-review-message-error')?.getAttribute('role')).toBe('alert');
    fixture.destroy();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [FormReviewActionDialogComponent] });
    const dueDate = TestBed.createComponent(FormReviewActionDialogComponent);
    dueDate.componentRef.setInput('kind', 'dueDate');
    dueDate.detectChanges();
    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    const hint = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toContain('Leave it empty to remove the due date.');
    dueDate.destroy();
  });
});
