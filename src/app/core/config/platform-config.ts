import { EnvironmentProviders, provideAppInitializer } from '@angular/core';
import { environment } from '@env/environment';

/**
 * Marca y dominio de la plataforma tal como los publica Tenant (`GET /platform/settings/public`).
 * Es la única fuente de la que el CRM saca el nombre comercial y los hosts: cambiar el dominio desde
 * PlatformAdmin no exige recompilar el bundle.
 */
export interface PlatformConfig {
  readonly version: number;
  readonly brandName: string;
  readonly baseDomain: string;
  /** Host de los endpoints del sistema (sin tenant). */
  readonly systemHost: string;
}

/** Lo que devuelve `/platform/settings/public` (solo lo que usa el CRM). */
export interface PublicPlatformSettings {
  version: number;
  brandName: string;
  baseDomain: string;
  apiHost: string;
}

let current: PlatformConfig = initialPlatformConfig(currentHostname());

/** La versión vigente. Se lee en cada uso: nunca se copia a una constante de módulo. */
export function platformConfig(): PlatformConfig {
  return current;
}

/** Nombre de la plataforma en la UI. Nunca va escrito en un template ni en un texto. */
export function platformBrand(): string {
  return current.brandName;
}

/** Aplica lo que publicó Tenant si es más nuevo que lo vigente. Devuelve si lo aplicó. */
export function applyPlatformSettings(settings: PublicPlatformSettings): boolean {
  const baseDomain = normalizeHost(settings.baseDomain);
  if (!baseDomain || !settings.brandName?.trim() || settings.version <= current.version) {
    return false;
  }
  current = {
    version: settings.version,
    brandName: settings.brandName.trim(),
    // En dev todo cuelga del gateway local: el dominio publicado no se usa para componer URLs.
    baseDomain: environment.production ? baseDomain : current.baseDomain,
    systemHost: environment.production ? normalizeHost(settings.apiHost) || `api.${baseDomain}` : current.systemHost,
  };
  return true;
}

/**
 * Punto de partida antes de que conteste Tenant. En prod el CRM solo se sirve en `app.{dominio}` o en
 * `{oficina}.{dominio}`, así que el dominio vigente es el host sin su primera etiqueta: el mismo bundle
 * funciona con cualquier dominio. Sin un host así (dev, tests) se usa el environment.
 */
export function initialPlatformConfig(hostname: string | null): PlatformConfig {
  const fallback: PlatformConfig = {
    version: 0,
    brandName: environment.brandName,
    baseDomain: environment.baseDomain,
    systemHost: environment.systemHost,
  };
  if (!environment.production || !hostname) {
    return fallback;
  }
  const labels = normalizeHost(hostname).split('.');
  if (labels.length < 3 || labels.every(label => /^\d+$/.test(label))) {
    return fallback;
  }
  const baseDomain = labels.slice(1).join('.');
  return { ...fallback, baseDomain, systemHost: `api.${baseDomain}` };
}

/**
 * Al arrancar pide la versión vigente a Tenant. No bloquea más de unos segundos ni rompe el arranque:
 * si Tenant no contesta, el CRM sigue con el dominio del host y el nombre del environment.
 */
export function providePlatformSettingsInitializer(): EnvironmentProviders {
  return provideAppInitializer(() => loadPlatformSettings());
}

export async function loadPlatformSettings(timeoutMs = 3000): Promise<void> {
  const base = environment.production ? `https://${current.systemHost}` : environment.apiUrl;
  if (!base) {
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/platform/settings/public`, { signal: controller.signal });
    if (response.ok) {
      applyPlatformSettings((await response.json()) as PublicPlatformSettings);
    }
  } catch {
    // Sin Tenant se queda la versión de arranque.
  } finally {
    clearTimeout(timer);
  }
}

/** Solo tests: vuelve al punto de partida. */
export function resetPlatformConfigForTests(hostname: string | null = null): void {
  current = initialPlatformConfig(hostname);
}

function currentHostname(): string | null {
  try {
    return window.location.hostname;
  } catch {
    return null;
  }
}

function normalizeHost(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.+$/, '');
}
