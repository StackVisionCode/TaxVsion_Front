/**
 * Redibuja un data URL sobre fondo BLANCO y lo exporta como PNG base64 (sin el prefijo data-url).
 * El fondo blanco es clave: un PNG transparente se sella NEGRO en PdfSharp (pinta el alfa como negro),
 * y el backend solo acepta PNG, así que re-codificamos cualquier origen (una subida JPEG, p. ej.).
 * Lo usan el gestor de "My Signatures" y la firma de oficina de Settings, por eso vive acá.
 */
export function toPngOnWhiteBase64(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 400;
      canvas.height = img.naturalHeight || 150;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('no-2d-context'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png').split(',')[1] ?? '');
    };
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = dataUrl;
  });
}
