#!/usr/bin/env node
/**
 * Quick smoke test for production server
 * Tests that it starts and responds to requests
 */

import { spawn } from 'child_process'
import { setTimeout as sleep } from 'timers/promises'

const PORT = 3333
let serverProcess

async function testServer() {
  try {
    // Start server
    console.log('Starting production server...')
    serverProcess = spawn('node', ['server/production.js', '--port', PORT.toString()], {
      cwd: process.cwd(),
      stdio: 'inherit',
    })

    // Wait for server to start
    await sleep(2000)

    // Test API endpoint
    console.log('\nTesting /api/config endpoint...')
    const apiResponse = await fetch(`http://localhost:${PORT}/api/config`)
    const apiData = await apiResponse.json()
    console.log('API Response:', JSON.stringify(apiData, null, 2))

    // Test static file
    console.log('\nTesting static file serving (index.html)...')
    const htmlResponse = await fetch(`http://localhost:${PORT}/`)
    const htmlText = await htmlResponse.text()
    console.log('HTML Response length:', htmlText.length, 'bytes')
    console.log('Contains React app:', htmlText.includes('root'))

    console.log('\n✓ Production server smoke test passed!')
    process.exit(0)
  } catch (err) {
    console.error('\n✗ Smoke test failed:', err.message)
    process.exit(1)
  } finally {
    if (serverProcess) {
      serverProcess.kill()
    }
  }
}

testServer()
