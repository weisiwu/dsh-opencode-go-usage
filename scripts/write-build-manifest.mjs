import { readdirSync, writeFileSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'

const outputDirectory = resolve(process.cwd(), process.argv[2] ?? 'lib')
const files = listFiles(outputDirectory).map(file => relative(outputDirectory, file).split(sep).join('/')).sort()

writeFileSync(resolve(outputDirectory, '.build-manifest.json'), `${JSON.stringify({ files }, null, 2)}\n`)

function listFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}
