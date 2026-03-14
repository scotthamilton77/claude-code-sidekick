import { test, expect } from '@playwright/test'

// Helper: find a project that has at least one session, returning both
async function findProjectWithSessions(
  request: Parameters<Parameters<typeof test>[1]>[0]['request']
): Promise<{
  project: { id: string; name: string }
  sessions: Array<{ id: string; title: string }>
} | null> {
  const projectsRes = await request.get('/api/projects')
  const { projects } = await projectsRes.json()
  for (const project of projects) {
    const sessionsRes = await request.get(
      `/api/projects/${encodeURIComponent(project.id)}/sessions`
    )
    const { sessions } = await sessionsRes.json()
    if (sessions.length > 0) {
      return { project, sessions }
    }
  }
  return null
}

test.describe('TB2 Timeline — API routes', () => {
  test('GET /api/projects/:id/sessions/:sid/timeline returns JSON with events array', async ({
    request,
  }) => {
    const found = await findProjectWithSessions(request)
    if (!found) {
      test.skip()
      return
    }

    const { project, sessions } = found
    const response = await request.get(
      `/api/projects/${encodeURIComponent(project.id)}/sessions/${encodeURIComponent(sessions[0].id)}/timeline`
    )
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('events')
    expect(Array.isArray(body.events)).toBe(true)
  })

  test('returns 404 for unknown project', async ({ request }) => {
    const response = await request.get(
      '/api/projects/nonexistent-project-id/sessions/fake-session/timeline'
    )
    expect(response.status()).toBe(404)

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  test('returns 404 for unknown session on a real project', async ({ request }) => {
    const found = await findProjectWithSessions(request)
    if (!found) {
      test.skip()
      return
    }

    const response = await request.get(
      `/api/projects/${encodeURIComponent(found.project.id)}/sessions/nonexistent-session-id/timeline`
    )
    expect(response.status()).toBe(404)

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })
})

test.describe('TB2 Timeline — UI rendering', () => {
  test('timeline panel is visible when a session is selected', async ({ page, request }) => {
    const found = await findProjectWithSessions(request)
    if (!found) {
      test.skip()
      return
    }

    await page.goto('/')
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Click the first session to select it
    const sessionTitle = found.sessions[0].title
    await page.getByText(sessionTitle).click()

    // The timeline panel (w-60) should now be visible, containing either events or "No events"
    const timelinePanel = page.locator('.w-60')
    await expect(timelinePanel).toBeVisible()

    // It should show either timeline event buttons or the "No events" empty state
    const eventButtons = timelinePanel.locator('button')
    const noEventsText = timelinePanel.getByText('No events')

    // Wait for loading to finish
    await expect(timelinePanel.getByText('Loading events')).toHaveCount(0, { timeout: 10_000 })

    // One of the two states must be true
    const eventCount = await eventButtons.count()
    const noEventsCount = await noEventsText.count()
    expect(eventCount > 0 || noEventsCount > 0).toBe(true)
  })

  test('timeline renders events for a session with log data', async ({ page, request }) => {
    const found = await findProjectWithSessions(request)
    if (!found) {
      test.skip()
      return
    }

    // Find a session that actually has timeline events
    let targetSession: { id: string; title: string } | null = null
    for (const session of found.sessions) {
      const timelineRes = await request.get(
        `/api/projects/${encodeURIComponent(found.project.id)}/sessions/${encodeURIComponent(session.id)}/timeline`
      )
      const { events } = await timelineRes.json()
      if (events.length > 0) {
        targetSession = session
        break
      }
    }

    if (!targetSession) {
      test.skip()
      return
    }

    await page.goto('/')
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Click the session that has events
    await page.getByText(targetSession.title).click()

    // Wait for timeline loading to finish
    const timelinePanel = page.locator('.w-60')
    await expect(timelinePanel.getByText('Loading events')).toHaveCount(0, { timeout: 10_000 })

    // Event buttons should be rendered inside the timeline panel
    const eventButtons = timelinePanel.locator('button')
    const count = await eventButtons.count()
    expect(count).toBeGreaterThan(0)
  })

  test('switching sessions reloads timeline', async ({ page, request }) => {
    const found = await findProjectWithSessions(request)
    if (!found || found.sessions.length < 2) {
      test.skip()
      return
    }

    await page.goto('/')
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Select the first session
    const firstTitle = found.sessions[0].title
    await page.getByText(firstTitle).click()

    // Wait for timeline to load
    const timelinePanel = page.locator('.w-60')
    await expect(timelinePanel.getByText('Loading events')).toHaveCount(0, { timeout: 10_000 })

    // The selector is now compressed; click the compressed label to re-expand
    const expectedLabel = `${found.project.name} / ${firstTitle}`
    const compressedButton = page.locator(`button[title="${expectedLabel}"]`)
    await expect(compressedButton).toBeVisible()
    await compressedButton.click()

    // Wait for the session list to re-appear
    await expect(page.getByText('Loading sessions...')).toHaveCount(0, { timeout: 10_000 })

    // Select the second session
    const secondTitle = found.sessions[1].title
    await page.getByText(secondTitle).click()

    // Wait for timeline to reload
    await expect(timelinePanel.getByText('Loading events')).toHaveCount(0, { timeout: 10_000 })

    // The timeline panel should still be visible with updated content
    await expect(timelinePanel).toBeVisible()
  })
})
