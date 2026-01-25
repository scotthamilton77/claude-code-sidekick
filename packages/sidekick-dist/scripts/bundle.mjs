#!/usr/bin/env node
/**
 * Bundle script for sidekick-dist
 *
 * Bundles CLI and daemon with version injection via esbuild's define option.
 * Single source of truth: version comes from package.json.
 */
import { execSync } from 'node:child_process'
import { readFileSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'))

const version = pkg.version

console.log(`Bundling sidekick v${version}...`)

// Clean dist and assets
rmSync(join(packageRoot, 'dist'), { recursive: true, force: true })
rmSync(join(packageRoot, 'assets'), { recursive: true, force: true })

// Create dist directory
mkdirSync(join(packageRoot, 'dist'), { recursive: true })

// Common esbuild flags
const commonFlags = [
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--main-fields=module,main',
  '--external:fsevents',
  `--define:__SIDEKICK_VERSION__='"${version}"'`,
].join(' ')

// Bundle CLI
console.log('  Bundling CLI...')
execSync(
  `esbuild ../sidekick-cli/dist/bin.js ${commonFlags} --outfile=dist/bin.js`,
  { cwd: packageRoot, stdio: 'inherit' }
)

// Bundle daemon
console.log('  Bundling daemon...')
execSync(
  `esbuild ../sidekick-daemon/dist/index.js ${commonFlags} --outfile=dist/daemon.js`,
  { cwd: packageRoot, stdio: 'inherit' }
)

// Copy assets
console.log('  Copying assets...')
mkdirSync(join(packageRoot, 'assets'), { recursive: true })
cpSync(
  join(packageRoot, '../sidekick-core/assets/sidekick'),
  join(packageRoot, 'assets/sidekick'),
  { recursive: true }
)

console.log(`✓ Bundle complete: sidekick v${version}`)
