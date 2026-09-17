/**
 * Build-output gate for dsh-opencode-go-usage: the staged lib/ must contain the
 * node half, the browser bundle, both type entry points and a manifest that
 * matches the staged file list exactly, and the browser bundle must register
 * itself with the DSH module loader under this package's id.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const PLUGIN_ID = 'dsh-opencode-go-usage'
const outputDirectory = resolve(process.cwd(), process.argv[2] ?? 'lib')
const artifactPath = file => resolve(outputDirectory, file)
const required = [
  'index.js',
  'client.js',
  'types/index.d.ts',
  'types/client/index.d.ts',
  '.build-manifest.json',
]

const missing = required.filter(file => !existsSync(artifactPath(file)))
if (missing.length > 0) {
  throw new Error(`build did not produce required artifacts: ${missing.join(', ')}`)
}
if (!statSync(outputDirectory).isDirectory()) throw new Error(`build output is not a directory: ${outputDirectory}`)

const manifest = JSON.parse(readFileSync(artifactPath('.build-manifest.json'), 'utf8'))
if (!Array.isArray(manifest.files) || manifest.files.some(file => typeof file !== 'string')) {
  throw new Error('build manifest is invalid')
}
if (new Set(manifest.files).size !== manifest.files.length) {
  throw new Error('build manifest contains duplicate files')
}

const actualFiles = listFiles(outputDirectory)
  .map(file => relative(outputDirectory, file).split(sep).join('/'))
  .filter(file => file !== '.build-manifest.json')
  .sort()
if (actualFiles.length !== manifest.files.length || actualFiles.some((file, index) => file !== manifest.files[index])) {
  throw new Error('build manifest does not match the staged artifacts')
}
const manifestMissingArtifacts = required.slice(0, -1).filter(file => !manifest.files.includes(file))
if (manifestMissingArtifacts.length > 0) {
  throw new Error(`build manifest is missing required artifacts: ${manifestMissingArtifacts.join(', ')}`)
}

const emittedJavaScript = ['index.js', 'client.js']
const staleImports = emittedJavaScript.filter(file =>
  /(?:from\s+|require\()['"][^'"]+\.ts['"]/.test(readFileSync(artifactPath(file), 'utf8')))
if (staleImports.length > 0) {
  throw new Error(`emitted JavaScript still imports TypeScript sources: ${staleImports.join(', ')}`)
}

const client = readFileSync(artifactPath('client.js'), 'utf8')
if (!client.includes('window.__ModuleLoader__.load') || !client.includes(PLUGIN_ID)) {
  throw new Error('client bundle does not register itself with the DSH module loader')
}

/**
 * The browser half must not carry host-only behaviour. The checks are for the
 * things only the host may do — read harness state, hold credentials, touch the
 * filesystem — not for shared contract constants: the public endpoint URL and
 * the protocol version legitimately live in the shared contract module and are
 * inlined into the bundle.
 */
const hostOnlyMarkers = ['settings.yaml', 'credentials.yaml', 'Bearer ', 'node:fs', 'node:path', 'resolveDshHome']
const leaked = hostOnlyMarkers.filter(marker => client.includes(marker))
if (leaked.length > 0) {
  throw new Error(`client bundle leaked host-only markers: ${leaked.join(', ')}`)
}

function listFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

console.log(`verified artifacts in ${outputDirectory}: ${actualFiles.length} files`)
