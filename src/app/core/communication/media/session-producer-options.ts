/**
 * Opciones de todo producer de mediasoup que publica pistas de la sesión local.
 *
 * La sesión es la dueña de cada pista: el mute es `track.enabled = false` y ella las detiene. Con los
 * valores por defecto de mediasoup-client el producer nace PAUSADO si la pista llega desactivada
 * (entrar con la cámara apagada o en mute), `replaceTrack` copia ese estado a la pista nueva (la cámara
 * real queda en negro) y `resume()` pone `enabled = true` (desmutearía un micrófono en mute).
 * Pausar = dejar de mandar RTP (transceiver inactivo), sin tocar la pista.
 */
export const SESSION_PRODUCER_OPTIONS = {
  stopTracks: false,
  disableTrackOnPause: false,
  zeroRtpOnPause: true,
} as const;
