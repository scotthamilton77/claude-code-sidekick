#!/usr/bin/env node
const { cpSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const workspaceRoot = join(__dirname, '..', '..', '..')
const src = join(workspaceRoot, 'assets', 'sidekick')
const dest = join(__dirname, '..', 'assets', 'sidekick')

mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`Copied assets to ${dest}`)
