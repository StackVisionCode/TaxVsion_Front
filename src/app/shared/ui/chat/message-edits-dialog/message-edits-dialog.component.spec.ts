import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageEditsDialogComponent } from './message-edits-dialog.component';

describe('MessageEditsDialogComponent (F8)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('[role="dialog"]').forEach(n => n.parentElement?.remove());
  });

  it('muestra el texto actual y debajo las versiones anteriores, de la última a la original', () => {
    const fixture = TestBed.createComponent(MessageEditsDialogComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('edits', {
      messageId: 'm1',
      currentBody: 'v3',
      editedAtUtc: '2026-10-31T15:10:00Z',
      versions: [
        { revision: 1, body: 'v1', replacedAtUtc: '2026-10-31T15:02:00Z' },
        { revision: 2, body: 'v2', replacedAtUtc: '2026-10-31T15:10:00Z' },
      ],
    });
    fixture.detectChanges();

    const items = [...document.querySelectorAll('[data-role="edit-versions"] li')].map(li => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('Current');
    expect(items[0]).toContain('v3');
    expect(items[1]).toContain('Version 2');
    expect(items[2]).toContain('Original');
    expect(items[2]).toContain('v1');
  });
});
