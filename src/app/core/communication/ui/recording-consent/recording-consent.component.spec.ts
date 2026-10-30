import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordingConsentComponent } from './recording-consent.component';

@Component({
  imports: [RecordingConsentComponent],
  template: `<app-recording-consent [requesterName]="name()" scope="call" (accepted)="accepted()" (declined)="declined()" />`,
})
class HostComponent {
  readonly name = signal<string | null>(null);
  readonly accepted = vi.fn();
  readonly declined = vi.fn();
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

describe('RecordingConsentComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
  });

  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return { fixture, host: fixture.componentInstance };
  }

  it('está cerrado sin requester y se abre con el nombre y el alcance', () => {
    const { fixture, host } = setup();
    expect(dialog()).toBeNull();
    host.name.set('Ana Pérez');
    fixture.detectChanges();
    expect(dialog()?.textContent).toContain('Ana Pérez wants to record this call');
  });

  it('emite accepted / declined con sus botones', () => {
    const { fixture, host } = setup();
    host.name.set('Ana');
    fixture.detectChanges();
    const buttons = [...dialog()!.querySelectorAll('button')];
    buttons.find(b => b.textContent?.includes('Allow recording'))!.click();
    expect(host.accepted).toHaveBeenCalledTimes(1);
    buttons.find(b => b.textContent?.includes('Decline'))!.click();
    expect(host.declined).toHaveBeenCalledTimes(1);
  });
});
