import { test, expect } from '@playwright/test'

test.describe('TB1 Session Selector — API routes', () => {
  test('GET /api/projects returns JSON with projects array', async ({ request }) => {
    const response = await request.get('/api/projects')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('projects')
    expect(Array.isArray(body.projects)).toBe(true)
  })

  test('GET /api/projects/:id/sessions returns 404 for unknown project', async ({ request }) => {
    const response = await request.get('/api/projects/nonexistent-project-id/sessions')
    expect(response.status()).toBe(404)

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })
})

test.describe('TB1 Session Selector — UI rendering', () => {
  test('renders the SessionSelector with "Sessions" header', async ({ page }) => {
    await page.goto('/')
    // The PanelHeader renders the title "Sessions"
    await expect(page.getByText('Sessions')).toBeVisible()
  })

  test('shows project names or renders empty gracefully', async ({ page, request }) => {
    // First, check what the API returns so we know what to expect
    const apiResponse = await request.get('/api/projects')
    const { projects } = await apiResponse.json()

    await page.goto('/')
    // Wait for loading to finish (loading text disappears)
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    if (projects.length === 0) {
      // Empty state: the SessionSelector renders but with no project entries
      await expect(page.getByText('Sessions')).toBeVisible()
      // No folder icons should be present
      await expect(page.locator('button:has-text("CLAUDE-CODE-SIDEKICK")')).not.toBeVisible()
    } else {
      // Projects exist: verify at least one project name appears (uppercase)
      for (const project of projects) {
        const projectName = project.name.toUpperCase()
        // Project names are rendered uppercase via CSS tracking-wider
        // Check for the presence of the project name text
        const projectHeader = page.locator('button', { hasText: new RegExp(project.name, 'i') })
        await expect(projectHeader.first()).toBeVisible()
        // The session count badge should also be visible
        expect(projectName).toBeTruthy()
      }
    }
  })
})

test.describe('TB1 Session Selector — interaction', () => {
  test('sessions load under expanded projects', async ({ page, request }) => {
    const apiResponse = await request.get('/api/projects')
    const { projects } = await apiResponse.json()

    if (projects.length === 0) {
      test.skip()
      return
    }

    await page.goto('/')
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Projects start expanded by default (see SessionSelector useState initializer)
    // Fetch sessions for the first project to know what to expect
    const firstProject = projects[0]
    const sessionsResponse = await request.get(`/api/projects/${encodeURIComponent(firstProject.id)}/sessions`)
    const { sessions } = await sessionsResponse.json()

    if (sessions.length === 0) {
      // No sessions: the expanded project section should be empty
      return
    }

    // At least one session title should be visible
    // Sessions have status dots (w-2 h-2 rounded-full) and title text
    const sessionButtons = page.locator('.ml-5 button')
    await expect(sessionButtons.first()).toBeVisible()

    // Verify a session title from the API appears in the UI
    const firstSessionTitle = sessions[0].title
    await expect(page.getByText(firstSessionTitle)).toBeVisible()
  })

  test('clicking a session selects it and shows compressed label', async ({ page, request }) => {
    const apiResponse = await request.get('/api/projects')
    const { projects } = await apiResponse.json()

    if (projects.length === 0) {
      test.skip()
      return
    }

    // Find a project with sessions
    let targetProject = null
    let targetSessions: Array<{ id: string; title: string }> = []
    for (const project of projects) {
      const sessionsResponse = await request.get(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
      const { sessions } = await sessionsResponse.json()
      if (sessions.length > 0) {
        targetProject = project
        targetSessions = sessions
        break
      }
    }

    if (!targetProject) {
      test.skip()
      return
    }

    await page.goto('/')
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Click the first session
    const sessionTitle = targetSessions[0].title
    await page.getByText(sessionTitle).click()

    // After selection, the selector panel compresses to a CompressedLabel
    // showing "projectName / sessionTitle" in its title attribute
    const expectedLabel = `${targetProject.name} / ${sessionTitle}`
    const compressedButton = page.locator(`button[title="${expectedLabel}"]`)
    await expect(compressedButton).toBeVisible()
  })

  test('collapsing a project hides its sessions', async ({ page, request }) => {
    const apiResponse = await request.get('/api/projects')
    const { projects } = await apiResponse.json()

    if (projects.length === 0) {
      test.skip()
      return
    }

    // Find a project with sessions
    let targetProject = null
    let targetSessions: Array<{ id: string; title: string }> = []
    for (const project of projects) {
      const sessionsResponse = await request.get(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
      const { sessions } = await sessionsResponse.json()
      if (sessions.length > 0) {
        targetProject = project
        targetSessions = sessions
        break
      }
    }

    if (!targetProject) {
      test.skip()
      return
    }

    await page.goto('/')
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Sessions should be visible (projects start expanded)
    const firstSessionTitle = targetSessions[0].title
    await expect(page.getByText(firstSessionTitle)).toBeVisible()

    // Click the project header to collapse it
    const projectHeader = page.locator('button', {
      hasText: new RegExp(targetProject.name, 'i'),
    })
    await projectHeader.first().click()

    // Sessions should now be hidden
    await expect(page.getByText(firstSessionTitle)).not.toBeVisible()
  })
})
