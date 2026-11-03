import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingsStore } from '../../data-access/meetings.store';
import { MeetingCodeResolution } from '../../data-access/meeting.model';
import { MeetingJoinCodeDialogComponent } from './meeting-join-code-dialog.component';

function resolution(overrides: Partial<MeetingCodeResolution> = {}): MeetingCodeResolution {
  return { meetingId: 'm1', title: 'Tax review', hostDisplayName: 'Ana', status: 'Live', requiresPasscode: false, isLocked: false, ...overrides };
}

function render() {
  const store = { resolveCode: vi.fn() };
  TestBed.configureTestingModule({ providers: [{ provide: MeetingsStore, useValue: store }] });
  const fixture = TestBed.createComponent(MeetingJoinCodeDialogComponent);
  const emitted: MeetingCodeResolution[] = [];
  fixture.componentInstance.resolved.subscribe(value => emitted.push(value));
  fixture.componentRef.setInput('isOpen', true);
  fixture.detectChanges();
  fixture.detectChanges();
  return { fixture, store, emitted, component: fixture.componentInstance };
}

describe('MeetingJoinCodeDialogComponent (MNT-01)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('[role="dialog"]').forEach(n => n.parentElement?.remove());
  });

  it('reunión en curso: emite la resolución con el id real', () => {
    const { component, store, emitted } = render();
    store.resolveCode.mockReturnValue(of(resolution()));
    component.code.set(' hfqgk4mqk ');
    component.submit();
    expect(store.resolveCode).toHaveBeenCalledWith('hfqgk4mqk');
    expect(emitted).toEqual([resolution()]);
  });

  it('no empezada o terminada: explica y no entra', () => {
    const { fixture, component, store, emitted } = render();
    store.resolveCode.mockReturnValue(of(resolution({ status: 'Scheduled' })));
    component.code.set('ABC');
    component.submit();
    expect(component.error()).toContain("hasn't started yet. Ask Ana to start it.");
    store.resolveCode.mockReturnValue(of(resolution({ status: 'Ended' })));
    component.submit();
    fixture.detectChanges();
    expect(component.error()).toContain('has ended');
    expect(emitted).toEqual([]);
  });

  it('código de otra oficina o inexistente (404): mensaje propio', () => {
    const { component, store } = render();
    store.resolveCode.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    component.code.set('ZZZ');
    component.submit();
    expect(component.error()).toBe('No meeting with that code in your office. Check the code and try again.');
  });
});
