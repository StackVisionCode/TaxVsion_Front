import { describe, expect, it } from 'vitest';
import { audioProduceOptions, videoProduceOptions } from './meeting-sfu.service';
import { mediaPolicyFixture } from './media/testing/media-policy.fixture';

describe('videoProduceOptions(source, policy)', () => {
  const policy = mediaPolicyFixture();

  it('cámara: 3 capas ¼/½/completa; la alta es camera.maxBitrateKbps y las otras proporcionales', () => {
    const { encodings, codecOptions } = videoProduceOptions('camera', policy);
    expect(encodings.map(e => e.rid)).toEqual(['r0', 'r1', 'r2']);
    expect(encodings.map(e => e.scaleResolutionDownBy)).toEqual([4, 2, undefined]);
    expect(encodings.map(e => e.maxBitrate)).toEqual([313_000, 625_000, 1_250_000]);
    expect(codecOptions.videoGoogleStartBitrate).toBe(625);
  });

  it('la cámara responde a la política: otro maxBitrateKbps → otras capas', () => {
    const smaller = mediaPolicyFixture({ video: { ...policy.video, camera: { ...policy.video.camera, maxBitrateKbps: 800 } } });
    expect(videoProduceOptions('camera', smaller).encodings.map(e => e.maxBitrate)).toEqual([200_000, 400_000, 800_000]);
  });

  it('pantalla: 2 capas cuando highBitrateKbps supera bitrateKbps; 1 si no', () => {
    const two = videoProduceOptions('screen', policy);
    expect(two.encodings).toEqual([
      { rid: 'r0', maxBitrate: 1_500_000, scaleResolutionDownBy: 2 },
      { rid: 'r1', maxBitrate: 3_000_000 },
    ]);
    const single = videoProduceOptions(
      'screen',
      mediaPolicyFixture({ video: { ...policy.video, screen: { ...policy.video.screen, highBitrateKbps: 1500 } } }),
    );
    expect(single.encodings).toEqual([{ rid: 'r0', maxBitrate: 1_500_000 }]);
    expect(single.codecOptions.videoGoogleStartBitrate).toBe(1500);
  });
});

describe('audioProduceOptions', () => {
  it('micro mono y audio de pantalla estéreo, con FEC/DTX/bitrate de la política', () => {
    const policy = mediaPolicyFixture({ audio: { ...mediaPolicyFixture().audio, opusDtx: false, maxAverageBitrateKbps: 32 } });
    expect(audioProduceOptions('microphone', policy)).toEqual({ opusStereo: false, opusDtx: false, opusFec: true, opusMaxAverageBitrate: 32_000 });
    expect(audioProduceOptions('screen', policy).opusStereo).toBe(true);
  });
});
