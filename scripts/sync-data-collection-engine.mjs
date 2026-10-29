import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// Uso:
//   node scripts/sync-data-collection-engine.mjs <ruta CLIENTTAXPROFRONTEND>   copia el engine al portal
//   node scripts/sync-data-collection-engine.mjs --check [ruta portal]          verifica la copia sin escribir
//   node scripts/sync-data-collection-engine.mjs --write-version                 solo regenera ENGINE_VERSION en el CRM
//   npm run check:data-collection-engine                                         = --check con la ruta por defecto
// Sin ruta, --check usa DATA_COLLECTION_PORTAL o `../CLIENTTAXPROFRONTEND` junto al CRM. Sale con 1 si la
// copia del portal o algún ENGINE_VERSION quedó viejo: sirve como gate en el CI de cualquiera de los dos.
// El destino es del engine salvo los `*.spec.ts`, que son del portal y nunca se borran ni se pisan
// (excepto `engine-version.spec.ts`, que genera este script).

const ENGINE_SEMVER = '1.0.0';
const VERSION_FILE = 'engine-version.ts';
const VERSION_SPEC = 'engine-version.spec.ts';
const crmRoot = path.resolve(import.meta.dirname, '..');
const source = path.join(crmRoot, 'src', 'app', 'shared', 'utils', 'data-collection');

const args = process.argv.slice(2);
const mode = args.includes('--check') ? 'check' : args.includes('--write-version') ? 'version' : 'sync';
const portalArgument = args.find((argument) => !argument.startsWith('--'));

const files = await listCanonicalFiles(source);
const hash = await contentHash(source, files);
const manifest = JSON.parse(
  await readFile(path.join(source, 'fixtures', 'v1', 'manifest.json'), 'utf8'),
);
const version = `${ENGINE_SEMVER}+sha256.${hash.slice(0, 12)}`;
const versionSource = versionModule(version, manifest.fixtureSetVersion);

if (mode === 'version') {
  await writeFile(path.join(source, VERSION_FILE), versionSource, 'utf8');
  process.stdout.write(`Data collection engine ${version} written to the CRM\n`);
} else {
  const portalRoot = resolvePortalRoot(
    portalArgument ??
      (mode === 'check'
        ? (process.env.DATA_COLLECTION_PORTAL ?? path.join(crmRoot, '..', 'CLIENTTAXPROFRONTEND'))
        : undefined),
  );
  const destination = path.join(portalRoot, 'src', 'app', 'shared', 'data-collection', 'engine');
  await validatePortal(portalRoot, destination);
  if (mode === 'check') await checkCopy(destination);
  else await syncCopy(destination);
}

async function syncCopy(destination) {
  await mkdir(destination, { recursive: true });
  const existing = await listFiles(destination);
  const canonical = new Set(files.map(normalize));
  // Solo se borran archivos de engine que ya no existen en el CRM; los specs del portal se conservan.
  for (const relative of existing) {
    const key = normalize(relative);
    if (canonical.has(key) || key === VERSION_FILE || isPortalOwned(key)) continue;
    await rm(path.join(destination, relative), { force: true });
  }
  for (const relative of files) {
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, relative), target);
  }
  await writeFile(path.join(source, VERSION_FILE), versionSource, 'utf8');
  await writeFile(path.join(destination, VERSION_FILE), versionSource, 'utf8');
  await writeFile(path.join(destination, VERSION_SPEC), portalVersionSpec(), 'utf8');
  process.stdout.write(`Data collection engine ${version} synchronized to ${destination}\n`);
}

async function checkCopy(destination) {
  const copied = (await listFiles(destination)).filter((relative) =>
    isCanonicalFile(normalize(relative)),
  );
  const copiedHash = await contentHash(destination, copied);
  const crmVersion = await readFile(path.join(source, VERSION_FILE), 'utf8');
  const portalVersion = await readFile(path.join(destination, VERSION_FILE), 'utf8').catch(
    () => '',
  );
  const problems = [];
  if (copiedHash !== hash) problems.push('the portal copy differs from the CRM engine');
  if (crmVersion.replaceAll('\r\n', '\n') !== versionSource)
    problems.push('the CRM ENGINE_VERSION is stale');
  if (portalVersion.replaceAll('\r\n', '\n') !== versionSource)
    problems.push('the portal ENGINE_VERSION is stale');
  if (problems.length > 0) {
    process.stderr.write(`Data collection engine check failed: ${problems.join('; ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Data collection engine ${version} matches ${destination}\n`);
}

function resolvePortalRoot(argument) {
  if (!argument?.trim()) {
    throw new Error(
      'Usage: node scripts/sync-data-collection-engine.mjs [--check] <CLIENTTAXPROFRONTEND path> | --write-version',
    );
  }
  return path.resolve(argument);
}

async function validatePortal(root, target) {
  const packageFile = path.join(root, 'package.json');
  const packageJson = JSON.parse(await readFile(packageFile, 'utf8'));
  if (packageJson.name !== 'clienttaxprofrontend') {
    throw new Error(`The destination is not CLIENTTAXPROFRONTEND: ${root}`);
  }
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe destination: ${target}`);
  }
}

async function listFiles(root, current = '') {
  const entries = await readdir(path.join(root, current), { withFileTypes: true }).catch(() => []);
  const result = [];
  for (const entry of entries) {
    const relative = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(root, relative)));
    else result.push(relative);
  }
  return result;
}

async function listCanonicalFiles(root) {
  return (await listFiles(root)).filter((relative) => isCanonicalFile(normalize(relative)));
}

function isCanonicalFile(normalized) {
  return !normalized.endsWith('.spec.ts') && normalized !== VERSION_FILE;
}

function isPortalOwned(normalized) {
  return normalized.endsWith('.spec.ts') && normalized !== VERSION_SPEC;
}

// Debe coincidir con `engine-version.spec.ts`: rutas con `/` en orden ordinal y saltos de línea LF.
async function contentHash(root, relatives) {
  const hash = createHash('sha256');
  const sorted = relatives.map(normalize).sort(compareOrdinal);
  for (const relative of sorted) {
    hash.update(relative);
    hash.update('\0');
    hash.update((await readFile(path.join(root, relative), 'utf8')).replaceAll('\r\n', '\n'));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function normalize(relative) {
  return relative.replaceAll('\\', '/');
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function versionModule(version, fixtureSetVersion) {
  return `// Generado por scripts/sync-data-collection-engine.mjs.\nexport const ENGINE_VERSION = '${version}';\nexport const FIXTURE_SET_VERSION = ${fixtureSetVersion};\n`;
}

// Karma corre en el navegador y no puede leer los archivos: el hash del portal se verifica con --check.
function portalVersionSpec() {
  return `import manifest from './fixtures/v1/manifest.json';\nimport { ENGINE_VERSION, FIXTURE_SET_VERSION } from './engine-version';\n\ndescribe('data collection engine version', () => {\n  it('matches the synchronized fixture set', () => {\n    expect(FIXTURE_SET_VERSION).toBe(manifest.fixtureSetVersion);\n    expect(ENGINE_VERSION).toMatch(/^\\d+\\.\\d+\\.\\d+\\+sha256\\.[a-f0-9]{12}$/);\n  });\n});\n`;
}
