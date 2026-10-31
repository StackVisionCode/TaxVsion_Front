import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveMeetingService } from '../../active-meeting.service';
import { sortRaisedHands } from '../../meeting-participants.util';
import type { MeetingParticipantDto } from '../../meeting.model';
import { MeetingParticipantsPanelComponent } from './participants-panel.component';

function participant(userId: string, overrides: Partial<MeetingParticipantDto> = {}): MeetingParticipantDto {
  return {
    userId,
    displayName: userId,
    actorType: 'TenantEmployee',
    role: 'Attendee',
    status: 'Joined',
    joinOrder: 1,
    audioEnabled: true,
    videoEnabled: false,
    screenSharing: false,
    handRaised: false,
    handRaisedAtUtc: null,
    ...overrides,
  };
}

function render(roster: MeetingParticipantDto[], isHost = true) {
  const participants = signal(roster);
  const meeting = {
    isHost: signal(isHost),
    isPrimaryHost: signal(isHost),
    myUserId: signal('me'),
    nowMs: signal(Date.parse('2026-10-30T12:10:00Z')),
    raisedHands: () => sortRaisedHands(participants()),
    waitingParticipants: () => participants().filter(p => p.status === 'Waiting'),
    joinedParticipants: () => participants().filter(p => p.status === 'Joined'),
    handRaised: signal(false),
    performHostAction: vi.fn(),
    lowerAllHands: vi.fn(),
    toggleHandRaise: vi.fn(),
  };
  TestBed.configureTestingModule({ providers: [{ provide: ActiveMeetingService, useValue: meeting }] });
  const fixture = TestBed.createComponent(MeetingParticipantsPanelComponent);
  fixture.componentRef.setInput('isOpen', true);
  fixture.detectChanges();
  // El drawer se porta al <body>.
  const panel = document.querySelector('[role="dialog"]') as HTMLElement;
  return { fixture, meeting, panel };
}

describe('MeetingParticipantsPanelComponent (D-49)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.querySelectorAll('[role="dialog"]').forEach(n => n.parentElement?.remove());
  });

  it('ordena la cola de manos por handRaisedAtUtc con "hace X" y ofrece Lower / Lower all al host', () => {
    const { panel, meeting } = render([
      participant('me', { joinOrder: 0, role: 'Host' }),
      participant('late', { joinOrder: 1, handRaised: true, handRaisedAtUtc: '2026-10-30T12:08:00Z' }),
      participant('early', { joinOrder: 2, handRaised: true, handRaisedAtUtc: '2026-10-30T12:01:00Z' }),
      participant('quiet', { joinOrder: 3 }),
    ]);
    const rows = [...panel.querySelectorAll('[data-role="raised-hands"] li')];
    expect(rows.map(r => r.getAttribute('data-user'))).toEqual(['early', 'late']);
    expect(rows[0].textContent).toContain('Raised 9m ago');
    expect(panel.querySelector('[data-role="raised-hands"] h3')?.textContent).toContain('Raised hands (2)');

    (rows[1].querySelector('[data-role="lower-hand"]') as HTMLButtonElement).click();
    expect(meeting.performHostAction).toHaveBeenCalledWith('lowerHand', 'late');
    (panel.querySelector('[data-role="lower-all"]') as HTMLButtonElement).click();
    expect(meeting.lowerAllHands).toHaveBeenCalledTimes(1);
  });

  it('un asistente ve la cola pero sin botones de host; yo primero en la lista; Invite solo para el host', () => {
    const { panel } = render([participant('other', { handRaised: true, handRaisedAtUtc: '2026-10-30T12:09:00Z' }), participant('me', { joinOrder: 5 })], false);
    expect(panel.querySelector('[data-role="lower-hand"]')).toBeNull();
    expect(panel.querySelector('[data-role="lower-all"]')).toBeNull();
    expect([...panel.querySelectorAll('[data-role="joined"] li')].map(li => li.getAttribute('data-user'))).toEqual(['me', 'other']);
    expect(panel.querySelector('[data-role="invite"]')).toBeNull();
  });

  it('el host ve Invite (F6: emite `invite`) y la sala de espera con Admit', () => {
    const { fixture, panel, meeting } = render([participant('me', { role: 'Host' }), participant('w1', { status: 'Waiting' })]);
    const invites = vi.fn();
    fixture.componentInstance.invite.subscribe(invites);
    const invite = panel.querySelector('[data-role="invite"]') as HTMLButtonElement;
    expect(invite.disabled).toBe(false);
    invite.click();
    expect(invites).toHaveBeenCalledTimes(1);
    const admit = [...panel.querySelectorAll('[data-role="waiting"] button')].find(b => b.textContent?.trim() === 'Admit') as HTMLButtonElement;
    admit.click();
    expect(meeting.performHostAction).toHaveBeenCalledWith('admit', 'w1');
  });

  it('con canInvite=false (sala de invitado) no hay pie Invite aunque sea host', () => {
    const { fixture } = render([participant('me', { role: 'Host' })]);
    fixture.componentRef.setInput('canInvite', false);
    fixture.detectChanges();
    expect(document.querySelector('[data-role="invite"]')).toBeNull();
  });
});
