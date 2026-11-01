import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionService } from '@core/auth/permission.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ActiveMeetingService, MeetingChatMessage } from '../active-meeting.service';
import { ActiveCallService } from '../active-call.service';
import { MeetingActiveSpeakerService, RemoteAudioSource } from '../meeting-active-speaker.service';
import { MeetingSessionState } from '../meeting-session-state';
import { MediaPolicyService } from '../media/media-policy.service';
import { fakeMediaPolicyService, mediaPolicyFixture } from '../media/testing/media-policy.fixture';
import { MeetingParticipantDto } from '../meeting.model';
import type { MeetingReaction } from '../meeting-reactions.util';
import { MeetingMiniPlayerComponent } from './meeting-mini-player.component';

function participant(userId: string, overrides: Partial<MeetingParticipantDto> = {}): MeetingParticipantDto {
  return {
    userId,
    displayName: userId,
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

/** Doble del ActiveMeetingService: lo que lee el mini-player, con un remoto dentro. */
function fakeMeeting(remotes: MeetingParticipantDto[], waiting: MeetingParticipantDto[] = []) {
  const me = participant('me', { joinOrder: 0 });
  const all = [me, ...remotes, ...waiting];
  const policy = mediaPolicyFixture();
  const reactions = signal<readonly MeetingReaction[]>([]);
  return {
    phase: signal('joined'),
    meetingTitle: signal('Weekly sync'),
    errorMessage: signal(null),
    localStream: signal(null),
    localScreenStream: signal(null),
    audioEnabled: signal(true),
    videoEnabled: signal(false),
    handRaised: signal(false),
    screenSharing: signal(false),
    screenAudioSharing: signal(false),
    muteReason: signal(null),
    videoPausedByNetwork: signal(false),
    microphoneError: signal(null),
    connectionQuality: signal('Good'),
    connectionMetrics: signal(null),
    isHost: signal(false),
    isPrimaryHost: signal(false),
    canEndForAll: signal(false),
    waitingParticipants: signal(waiting),
    recordingConsentFrom: signal(null),
    recordingElapsedLabel: signal('0:00'),
    recordingRemainingLabel: signal(null),
    recordingState: signal('Idle'),
    roomViewAttached: signal(false),
    chatPanelOpen: signal(false),
    durationWarning: signal(null),
    pinnedUserId: signal(null),
    clockLabel: signal('0:10'),
    endedTitle: signal(''),
    participants: signal(all),
    joinedParticipants: signal([me, ...remotes]),
    remoteParticipants: signal(remotes),
    peers: signal(new Map()),
    myUserId: signal('me'),
    selfParticipant: signal(me),
    nowMs: signal(Date.now()),
    raisedHandCount: signal(0),
    reactionsPolicy: signal(policy.reactions),
    reactionsEnabled: signal(true),
    reactions,
    reactionByUser: computed(() => new Map(reactions().map(r => [r.userId, r]))),
    chatUnread: signal(0),
    chatMessages: signal<MeetingChatMessage[]>([]),
    closeEnded: vi.fn(),
    leave: vi.fn(),
    startScreenShare: vi.fn(),
    admit: vi.fn(),
    deny: vi.fn(),
    markChatRead: vi.fn(),
    sendChatMessage: vi.fn(),
    performHostAction: vi.fn(),
    react: vi.fn(),
    toggleAudio: vi.fn(),
    toggleVideo: vi.fn(),
    toggleHandRaise: vi.fn(),
  };
}

function fakeSpeaker(screenAudio: RemoteAudioSource[]) {
  const volumes = signal<Record<string, number>>({});
  return {
    remoteAudio: signal<RemoteAudioSource[]>([]),
    remoteScreenAudio: signal(screenAudio),
    speakingIds: signal(new Set<string>()),
    selfSpeaking: signal(false),
    activeSpeakerId: signal(null),
    lastVoiceAt: signal({}),
    levelBars: signal({}),
    audioSuspended: signal(false),
    barsOf: () => 0,
    screenAudioVolume: (userId: string) => volumes()[userId] ?? 1,
    setScreenAudioVolume: vi.fn((userId: string, v: number) => volumes.update(m => ({ ...m, [userId]: v }))),
  };
}

function configure(remotes: MeetingParticipantDto[], screenAudio: RemoteAudioSource[] = [], callPhase = 'idle', waiting: MeetingParticipantDto[] = []) {
  const meeting = fakeMeeting(remotes, waiting);
  const speaker = fakeSpeaker(screenAudio);
  TestBed.configureTestingModule({
    imports: [MeetingMiniPlayerComponent], // con `@defer` el metadata se resuelve en compileComponents
    providers: [
      { provide: ActiveMeetingService, useValue: meeting },
      { provide: MeetingActiveSpeakerService, useValue: speaker },
      { provide: ActiveCallService, useValue: { phase: signal(callPhase) } },
      { provide: MediaPolicyService, useValue: fakeMediaPolicyService() },
      { provide: PermissionService, useValue: { isActor: () => true, has: () => false } },
      { provide: Router, useValue: { navigateByUrl: vi.fn() } },
      { provide: ToastService, useValue: { info: vi.fn(), success: vi.fn(), error: vi.fn() } },
    ],
  });
  return { meeting, speaker };
}

/** El mini-player tiene bloques `@defer` (picker de reacciones): hay que compilar antes de crear. */
async function render(remotes: MeetingParticipantDto[], screenAudio: RemoteAudioSource[] = [], callPhase = 'idle', waiting: MeetingParticipantDto[] = []) {
  const deps = configure(remotes, screenAudio, callPhase, waiting);
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(MeetingMiniPlayerComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, ...deps };
}

describe('MeetingMiniPlayerComponent — F4', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reproduce el audio de cada pantalla compartida en su propio <audio> con volumen propio', async () => {
    const stream = { addEventListener() {}, removeEventListener() {}, getTracks: () => [] } as unknown as MediaStream;
    const { el, fixture, speaker } = await render([participant('u1', { screenSharing: true })], [{ userId: 'u1', trackId: 't-screen', stream }]);
    const audio = el.querySelector('audio[data-role="screen-audio"][data-user="u1"]') as HTMLAudioElement;
    expect(audio).not.toBeNull();
    expect(audio.volume).toBe(1);
    expect(audio.hasAttribute('muted')).toBe(false);

    const slider = el.querySelector('input[type="range"]') as HTMLInputElement;
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(speaker.setScreenAudioVolume).toHaveBeenCalledWith('u1', 0.3);
    expect(audio.volume).toBeCloseTo(0.3);
  });

  it('muestra mi badge de calidad y el punto de alerta cuando algún remoto está Poor', async () => {
    const { el } = await render([participant('u1', { connectionQuality: 'Poor' })]);
    expect(el.querySelector('[data-role="own-quality"] [role="img"]')?.getAttribute('aria-label')).toBe('Good connection');
    expect(el.querySelector('[data-role="remote-poor"]')).not.toBeNull();

    TestBed.resetTestingModule();
    const ok = await render([participant('u1', { connectionQuality: 'Good' })]);
    expect(ok.el.querySelector('[data-role="remote-poor"]')).toBeNull();
  });

  it('T-58: con el overlay de llamada en pantalla, el panel se corre para no solaparse', async () => {
    const { fixture, el } = await render([participant('u1')], [], 'incoming');
    const component = fixture.componentInstance;
    expect(component.callVisible()).toBe(true);
    if (component.isDesktop()) {
      expect(component.effectivePosition()).not.toBeNull();
    } else {
      expect((el.querySelector('section') as HTMLElement).className).toContain('bottom-[11.5rem]');
    }
  });
});

describe('MeetingMiniPlayerComponent — F5 (T-54)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('la pantalla compartida es el principal, el hablante va en el PiP interno y "View camera" alterna', async () => {
    const { el, fixture } = await render([participant('u1', { screenSharing: true }), participant('u2')]);
    expect(el.querySelector('[data-role="main-screen"]')).not.toBeNull();
    expect(el.querySelector('[data-role="inner-pip"] [data-user="u1"][data-size="sm"]')).not.toBeNull();
    const toggle = el.querySelector('[data-role="main-view-toggle"]') as HTMLButtonElement;
    expect(toggle.textContent?.trim()).toBe('View camera');
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-role="main-screen"]')).toBeNull();
    expect(el.querySelector('[data-role="main-tile"] [data-user="u1"][data-size="md"]')).not.toBeNull();
    expect(el.querySelector('[data-role="main-view-toggle"]')?.textContent?.trim()).toBe('View screen');
  });

  it('las miniaturas son el tile único en sm y el principal el tile md', async () => {
    const { el } = await render([participant('u1'), participant('u2'), participant('u3')]);
    expect(el.querySelector('[data-role="main-tile"] [data-user="u1"][data-size="md"]')).not.toBeNull();
    expect([...el.querySelectorAll('[data-role="thumbs"] [data-size="sm"]')].map(n => n.getAttribute('data-user'))).toEqual(['u2', 'u3']);
    expect(el.querySelector('[data-role="inner-pip"] [data-user="me"][data-size="sm"]')).not.toBeNull();
  });

  it('host: "N waiting" con Admit directo', async () => {
    const { meeting } = configure([participant('u1')], [], 'idle', [participant('w1', { status: 'Waiting' }), participant('w2', { status: 'Waiting' })]);
    meeting.isHost.set(true);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(MeetingMiniPlayerComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-role="waiting"]')?.textContent).toContain('2 waiting to join');
    (el.querySelector('[data-role="waiting"] [data-user="w1"] [data-role="admit"]') as HTMLButtonElement).click();
    expect(meeting.admit).toHaveBeenCalledWith('w1');
  });

  it('chat compacto: badge de no leídos, abrirlo marca leído y envía', async () => {
    const { el, fixture, meeting } = await render([participant('u1')]);
    meeting.chatUnread.set(3);
    meeting.chatMessages.set([
      { id: 'm1', senderName: 'Bo', text: 'hola', time: '12:00', isMine: false, senderUserId: 'bo', createdAtUtc: '2026-10-31T12:00:00Z', isEdited: false, editCount: 0, isDeleted: false },
    ]);
    fixture.detectChanges();
    const chatButton = el.querySelector('[data-control="chat"]') as HTMLButtonElement;
    expect(chatButton.textContent).toContain('3');
    chatButton.click();
    fixture.detectChanges();
    expect(meeting.markChatRead).toHaveBeenCalled();
    expect(el.querySelector('[data-role="compact-chat"]')?.textContent).toContain('hola');
    fixture.componentInstance.chatDraft.set('  hey ');
    fixture.componentInstance.sendChat();
    expect(meeting.sendChatMessage).toHaveBeenCalledWith('hey');
  });

  it('React aparece solo si la política lo permite; ya no hay "Pop out" a una ventana del navegador', async () => {
    const { el, fixture, meeting } = await render([participant('u1')]);
    expect(el.querySelector('[data-control="react"]')).not.toBeNull();
    expect(el.querySelector('[data-role="pip"]')).toBeNull();

    meeting.reactionsEnabled.set(false);
    fixture.detectChanges();
    expect(el.querySelector('[data-control="react"]')).toBeNull();
  });

  it('con la sala abierta no se monta (no hay dos vistas de la misma reunión)', async () => {
    const { el, fixture, meeting } = await render([participant('u1')]);
    meeting.roomViewAttached.set(true);
    fixture.detectChanges();
    expect(el.querySelector('section')).toBeNull();
  });
});

describe('MeetingMiniPlayerComponent — F6 (Invite)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('el host ve "Invite": marca invitePanelRequested y vuelve a la sala; un asistente no lo ve', async () => {
    const { meeting } = configure([participant('u1')]);
    meeting.isHost.set(true);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(MeetingMiniPlayerComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const session = TestBed.inject(MeetingSessionState);
    const router = TestBed.inject(Router) as unknown as { navigateByUrl: ReturnType<typeof vi.fn> };

    (el.querySelector('[data-control="invite"]') as HTMLButtonElement).click();
    expect(session.invitePanelRequested()).toBe(true);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/meetings');
    session.invitePanelRequested.set(false);

    meeting.isHost.set(false);
    fixture.detectChanges();
    expect(el.querySelector('[data-control="invite"]')).toBeNull();
  });
});
