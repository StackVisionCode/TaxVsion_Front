import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ECHO_OPTIONS, EchoDetector, EchoSample, detectEcho } from './echo-detector';

const talkBoth = (erle: number | null = 2): EchoSample => ({ erle, localLevel: 0.2, remoteLevel: 0.3 });
const remoteOnly = (erle: number | null = 20): EchoSample => ({ erle, localLevel: 0.001, remoteLevel: 0.3 });
const silence: EchoSample = { erle: null, localLevel: 0, remoteLevel: 0 };

describe('detectEcho', () => {
  it('no decide sin ventana completa ni cuando nadie habla del otro lado', () => {
    expect(detectEcho([talkBoth(), talkBoth()])).toBe(false);
    expect(detectEcho(Array(5).fill(silence))).toBe(false);
  });

  it('eco probable: el micro sigue al remoto y el ERLE es bajo', () => {
    expect(detectEcho(Array(5).fill(talkBoth(2)))).toBe(true);
  });

  it('con buen ERLE no es eco aunque ambos suenen (conversación real)', () => {
    expect(detectEcho(Array(5).fill(talkBoth(15)))).toBe(false);
  });

  it('sin ERLE solo queda la correlación; remoto solo → no es eco', () => {
    expect(detectEcho(Array(5).fill(talkBoth(null)))).toBe(true);
    expect(detectEcho(Array(5).fill(remoteOnly()))).toBe(false);
  });

  it('EchoDetector avisa una vez por episodio', () => {
    const onEcho = vi.fn();
    const detector = new EchoDetector(DEFAULT_ECHO_OPTIONS, onEcho);
    for (let i = 0; i < 6; i++) {
      detector.pushSample(talkBoth(2));
    }
    expect(detector.echoSuspected()).toBe(true);
    expect(onEcho).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) {
      detector.pushSample(remoteOnly());
    }
    expect(detector.echoSuspected()).toBe(false);
  });
});
