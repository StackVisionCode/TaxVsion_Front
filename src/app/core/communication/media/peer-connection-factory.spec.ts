import { describe, expect, it } from 'vitest';
import { applyOpusSdpOptions } from './peer-connection-factory';

const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=0',
  'a=rtpmap:63 red/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=rtpmap:96 VP8/90000',
].join('\r\n');

describe('applyOpusSdpOptions', () => {
  it('fija FEC/DTX/maxaveragebitrate en el fmtp de Opus y conserva el resto (y el CRLF)', () => {
    const out = applyOpusSdpOptions(SDP, { fec: true, dtx: true, maxAverageBitrateKbps: 40 });
    expect(out).toContain('a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=40000');
    expect(out).toContain('a=rtpmap:96 VP8/90000');
    expect(out.split('\r\n')).toHaveLength(SDP.split('\r\n').length);
  });

  it('agrega la línea fmtp cuando Opus no la tenía', () => {
    const sdp = 'm=audio 9 UDP/TLS/RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\na=rtcp-fb:111 transport-cc';
    const out = applyOpusSdpOptions(sdp, { fec: false, dtx: true, maxAverageBitrateKbps: null });
    expect(out.split('\n')).toEqual([
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 useinbandfec=0;usedtx=1',
      'a=rtcp-fb:111 transport-cc',
    ]);
  });

  it('sin Opus devuelve el SDP intacto', () => {
    const sdp = 'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000';
    expect(applyOpusSdpOptions(sdp, { fec: true, dtx: true, maxAverageBitrateKbps: 40 })).toBe(sdp);
  });
});
