import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunicationRealtimeService } from '@core/realtime/communication-realtime.service';
import { ActiveMeetingService } from '@core/communication/active-meeting.service';
import { MediaPolicyService } from '@core/communication/media/media-policy.service';
import { MeetingActiveSpeakerService } from '@core/communication/meeting-active-speaker.service';
import { MediaDevicesService } from '@core/communication/media/media-devices.service';
import { mediaPolicyFixture } from '@core/communication/media/testing/media-policy.fixture';
import { MediaLobbyComponent } from '@core/communication/ui/media-lobby/media-lobby.component';
import { MeetingRemoteAudioComponent } from '@core/communication/ui/remote-audio/meeting-remote-audio.component';
import { MeetingRoomComponent } from '@features/meetings/ui/meeting-room/meeting-room.component';
import { GuestMeetingService } from './data-access/guest-meeting.service';
import { GuestMeetingContext } from './data-access/guest-meeting.model';
import { GuestMeetingPageComponent } from './guest-meeting-page.component';

// Dobles livianos de la sala, el lobby y el audio: la página se prueba por su propia máquina de estados.
@Component({ selector: 'app-meeting-room', template: '<p data-role="room-stub">room</p>' })
class RoomStub {}
@Component({ selector: 'app-media-lobby', template: '<p data-role="lobby-stub">lobby</p>' })
class LobbyStub {}
@Component({ selector: 'app-meeting-remote-audio', template: '' })
class AudioStub {}

function context(overrides: Partial<GuestMeetingContext> = {}): GuestMeetingContext {
  return {
    meetingTitle: 'Tax review',
    hostDisplayName: 'Ana Pérez',
    scheduledForUtc: '2026-10-30T15:00:00Z',
    durationMinutes: 45,
    status: 'Live',
    shortCode: 'ABC123',
    inviteeName: 'Guest One',
    guestsAllowed: true,
    waitingRoom: true,
    mediaPolicy: mediaPolicyFixture({ version: 5 }),
    ...overrides,
  };
}

function setup(ctx: GuestMeetingContext | HttpErrorResponse, token = 'tok-1') {
  const service = {
    context: vi.fn().mockReturnValue(ctx instanceof HttpErrorResponse ? throwError(() => ctx) : of(ctx)),
    joinByToken: vi.fn().mockReturnValue(of({ shortLivedJoinTicket: 'ticket', meetingId: 'm1', shortCode: 'ABC123', tenantId: 't', invitationId: 'inv-1' })),
  };
  const phase = signal<'idle' | 'joining' | 'waiting' | 'joined' | 'ended'>('idle');
  const meeting = {
    phase,
    errorMessage: signal<string | null>(null),
    removedReason: signal<string | null>(null),
    joinAsGuest: vi.fn(async () => phase.set('joined')),
    leave: vi.fn(async () => phase.set('idle')),
  };
  const realtime = { connected: signal(false), connectAsGuest: vi.fn(async () => realtime.connected.set(true)), disconnect: vi.fn() };
  const mediaPolicy = { prime: vi.fn(), unprime: vi.fn(), policy: signal(null) };
  const speaker = { primeAudioContext: vi.fn().mockResolvedValue(true) };
  const title = { setTitle: vi.fn() };

  TestBed.configureTestingModule({
    imports: [GuestMeetingPageComponent],
    providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ token }) } } },
      { provide: GuestMeetingService, useValue: service },
      { provide: ActiveMeetingService, useValue: meeting },
      { provide: CommunicationRealtimeService, useValue: realtime },
      { provide: MediaPolicyService, useValue: mediaPolicy },
      { provide: MeetingActiveSpeakerService, useValue: speaker },
      { provide: MediaDevicesService, useValue: {} },
      { provide: Title, useValue: title },
    ],
  });
  TestBed.overrideComponent(GuestMeetingPageComponent, {
    remove: { imports: [MeetingRoomComponent, MediaLobbyComponent, MeetingRemoteAudioComponent] },
    add: { imports: [RoomStub, LobbyStub, AudioStub] },
  });
  const fixture = TestBed.createComponent(GuestMeetingPageComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, service, meeting, realtime, mediaPolicy, speaker, title, component: fixture.componentInstance };
}

const flush = async (fixture: { detectChanges: () => void }) => {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.detectChanges();
};

describe('GuestMeetingPageComponent (F6, D-47)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('404 del contexto → "This invitation link is not valid" (uniforme, sin pedir nombre)', () => {
    const { el, component } = setup(new HttpErrorResponse({ status: 404 }));
    expect(component.state()).toBe('invalid');
    expect(el.textContent).toContain('This invitation link is not valid');
  });

  it('guestsAllowed:false → "This office doesn\'t allow external guests"', () => {
    const { el, component } = setup(context({ guestsAllowed: false }));
    expect(component.state()).toBe('guests-off');
    expect(el.textContent).toContain("This office doesn't allow external guests");
  });

  it('status Ended → "This meeting has ended"', () => {
    const { el, component } = setup(context({ status: 'Ended' }));
    expect(component.state()).toBe('ended');
    expect(el.textContent).toContain('This meeting has ended');
  });

  it('contexto válido: prima la política, pone el título del documento y pide el nombre con prefill', () => {
    const { el, component, mediaPolicy, title } = setup(context());
    expect(component.state()).toBe('name');
    expect(mediaPolicy.prime).toHaveBeenCalledWith(expect.objectContaining({ version: 5 }));
    expect(title.setTitle).toHaveBeenCalledWith('Tax review · Meeting');
    expect(component.displayName()).toBe('Guest One');
    expect(el.textContent).toContain('Hosted by Ana Pérez');
    expect(el.textContent).toContain('In progress');
    expect((el.querySelector('[data-role="continue"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sin nombre no se puede continuar; con nombre → lobby → join-by-token → connectAsGuest → joinAsGuest → sala', async () => {
    const { fixture, el, component, service, realtime, meeting, speaker } = setup(context({ inviteeName: null }));
    expect(component.canContinue()).toBe(false);
    component.displayName.set('  Bob  ');
    component.continueToLobby();
    fixture.detectChanges();
    expect(component.state()).toBe('lobby');
    expect(el.querySelector('[data-role="lobby-stub"]')).not.toBeNull();

    await component.joinFromLobby({ audio: true, video: false });
    await flush(fixture);

    expect(speaker.primeAudioContext).toHaveBeenCalled();
    expect(service.joinByToken).toHaveBeenCalledWith('tok-1', 'Bob');
    expect(realtime.connectAsGuest).toHaveBeenCalledWith('ticket');
    expect(meeting.joinAsGuest).toHaveBeenCalledWith('m1', 'Tax review', 'inv-1', { audio: true, video: false });
    expect(component.state()).toBe('room');
    expect(el.querySelector('[data-role="room-stub"]')).not.toBeNull();
  });

  it('403 Meeting.GuestsNotAllowed al pedir el ticket → pantalla de oficina sin invitados; 404 → enlace no válido', async () => {
    const { fixture, component, service } = setup(context());
    component.displayName.set('Bob');
    component.continueToLobby();
    service.joinByToken.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'Meeting.GuestsNotAllowed', message: 'no' } })));
    await component.joinFromLobby({ audio: true, video: true });
    await flush(fixture);
    expect(component.state()).toBe('guests-off');

    component.state.set('lobby');
    service.joinByToken.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    await component.joinFromLobby({ audio: true, video: true });
    await flush(fixture);
    expect(component.state()).toBe('invalid');
  });

  it('Leave → "You left the meeting" con Rejoin (socket vivo: vuelve a entrar sin pedir otro ticket)', async () => {
    const { fixture, el, component, service, meeting, realtime } = setup(context());
    component.displayName.set('Bob');
    component.continueToLobby();
    await component.joinFromLobby({ audio: true, video: true });
    await flush(fixture);
    expect(component.state()).toBe('room');

    meeting.phase.set('idle'); // la sala hizo leave()
    fixture.detectChanges();
    expect(component.state()).toBe('left');
    expect(el.textContent).toContain('You left the meeting');

    (el.querySelector('[data-role="rejoin"]') as HTMLButtonElement).click();
    await flush(fixture);
    expect(service.joinByToken).toHaveBeenCalledTimes(1);
    expect(realtime.connectAsGuest).toHaveBeenCalledTimes(1);
    expect(meeting.joinAsGuest).toHaveBeenCalledTimes(2);
    expect(component.state()).toBe('room');
  });

  it('meeting.you.removed Revoked → "Your invitation was revoked"; fin por el servidor → "This meeting has ended"', async () => {
    const { fixture, el, component, meeting } = setup(context());
    component.displayName.set('Bob');
    component.continueToLobby();
    await component.joinFromLobby({ audio: true, video: true });
    await flush(fixture);

    meeting.removedReason.set('Revoked');
    meeting.phase.set('idle');
    fixture.detectChanges();
    expect(component.state()).toBe('revoked');
    expect(el.textContent).toContain('Your invitation was revoked');
    expect(el.querySelector('[data-role="rejoin"]')).toBeNull();

    // Otra entrada: la reunión termina (fase 'ended' en la sala) y el guest cierra la pantalla de fin.
    meeting.removedReason.set(null);
    component.state.set('lobby');
    await component.joinFromLobby({ audio: true, video: true });
    await flush(fixture);
    meeting.phase.set('ended');
    fixture.detectChanges();
    meeting.phase.set('idle');
    fixture.detectChanges();
    expect(component.state()).toBe('ended');
  });

  it('al destruirse sale de la reunión y cierra el socket', async () => {
    const { fixture, component, meeting, realtime, mediaPolicy } = setup(context());
    component.displayName.set('Bob');
    component.continueToLobby();
    await component.joinFromLobby({ audio: true, video: true });
    await flush(fixture);

    fixture.destroy();
    expect(meeting.leave).toHaveBeenCalled();
    expect(realtime.disconnect).toHaveBeenCalled();
    expect(mediaPolicy.unprime).toHaveBeenCalled();
  });
});
