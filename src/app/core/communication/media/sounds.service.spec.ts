import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '@shared/ui/toast/toast.service';
import { SoundsService } from './sounds.service';
import { MediaPolicyService } from './media-policy.service';
import { fakeMediaPolicyService, mediaPolicyFixture } from './testing/media-policy.fixture';

/** `Audio` de mentira: registra volumen y reproducciones. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  volume = 1;
  currentTime = 0;
  preload = '';
  play = vi.fn().mockResolvedValue(undefined);
  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }
}

describe('SoundsService (T-70)', () => {
  const originalAudio = globalThis.Audio;
  const originalMatchMedia = globalThis.matchMedia;
  let reducedMotion = false;

  beforeEach(() => {
    FakeAudio.instances = [];
    reducedMotion = false;
    globalThis.Audio = FakeAudio as unknown as typeof Audio;
    globalThis.matchMedia = ((query: string) => ({ matches: query.includes('reduce') && reducedMotion })) as unknown as typeof matchMedia;
  });

  afterEach(() => {
    globalThis.Audio = originalAudio;
    globalThis.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  function setup(sounds: Partial<ReturnType<typeof mediaPolicyFixture>['sounds']> = {}, loaded = true) {
    const policy = mediaPolicyFixture({ sounds: { ...mediaPolicyFixture().sounds, ...sounds } });
    const mediaPolicy = fakeMediaPolicyService(policy);
    if (!loaded) {
      mediaPolicy.policy.set(null);
    }
    const ensureLoaded = vi.fn().mockResolvedValue(policy);
    const toast = { info: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        SoundsService,
        { provide: MediaPolicyService, useValue: { ...mediaPolicy, ensureLoaded } },
        { provide: ToastService, useValue: toast },
      ],
    });
    return { service: TestBed.inject(SoundsService), toast, ensureLoaded };
  }

  const plays = () => FakeAudio.instances.reduce((n, a) => n + a.play.mock.calls.length, 0);

  it('reproduce con el volumen de la política y mapea los sonidos de llamada a los assets existentes', () => {
    const { service } = setup({ volumePct: 25 });
    service.play('connected', { isHost: true });
    expect(FakeAudio.instances[0].src).toContain('entrada-meeting.mp3');
    expect(FakeAudio.instances[0].volume).toBe(0.25);
    expect(plays()).toBe(1);
  });

  it('respeta el gap de repetición por sonido', () => {
    vi.useFakeTimers();
    const { service } = setup({ repeatGapMs: 400 });
    service.play('chat-message');
    service.play('chat-message');
    expect(plays()).toBe(1);
    vi.advanceTimersByTime(401);
    service.play('chat-message');
    expect(plays()).toBe(2);
  });

  it('policy off y muted del usuario silencian todo', () => {
    const off = setup({ policy: 'off' });
    off.service.play('join', { isHost: true });
    TestBed.resetTestingModule();
    const muted = setup({ muted: true });
    muted.service.play('notification');
    expect(plays()).toBe(0);
  });

  it('hostOnly: join/leave solo suenan al host; los demás sonidos siguen para todos', () => {
    const { service } = setup({ policy: 'hostOnly' });
    service.play('join', { isHost: false });
    expect(plays()).toBe(0);
    service.play('join', { isHost: true });
    expect(plays()).toBe(1);
    service.play('notification', { isHost: false });
    expect(plays()).toBe(2);
  });

  it('con prefers-reduced-motion no suena pero muestra el equivalente visual', () => {
    reducedMotion = true;
    const { service, toast } = setup();
    service.play('join', { isHost: true, fallbackText: 'Ana joined' });
    expect(plays()).toBe(0);
    expect(toast.info).toHaveBeenCalledWith('Ana joined');
  });

  it('sin política cargada no inventa valores: pide la carga y no suena', () => {
    const { service, ensureLoaded } = setup({}, false);
    service.play('join', { isHost: true });
    expect(plays()).toBe(0);
    expect(ensureLoaded).toHaveBeenCalled();
  });
});
