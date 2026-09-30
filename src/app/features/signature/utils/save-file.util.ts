/**
 * Descarga una URL presignada (CloudStorage) con un nombre de archivo propio (12.3/12.4).
 *
 * El atributo `download` de un <a> se ignora en URLs de otro origen, así que se baja el archivo como
 * blob y se guarda vía object URL (mismo origen). Se usa `fetch` plano y NO HttpClient: los
 * interceptores añadirían el Bearer y romperían la firma de la URL presignada.
 *
 * Si el fetch falla (típicamente CORS del bucket), cae a abrir la URL en otra pestaña, que es lo
 * que se hacía antes: el usuario obtiene el archivo igual, solo que con el nombre del storage.
 * Devuelve `true` si se guardó con el nombre pedido y `false` si se usó el fallback.
 */
export async function saveUrlAs(url: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Se libera con un margen: revocar en el acto puede abortar la descarga en algunos navegadores.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return true;
  } catch {
    window.open(url, '_blank', 'noopener');
    return false;
  }
}
