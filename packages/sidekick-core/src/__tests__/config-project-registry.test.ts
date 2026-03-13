import { describe, it, expect } from 'vitest'
import { createConfigService } from '../config.js'
import { createAssetResolver, getDefaultAssetsDir } from '../assets.js'

describe('projects.retentionDays config', () => {
  it('defaults to 30 days', () => {
    const assetResolver = createAssetResolver({
      defaultAssetsDir: getDefaultAssetsDir(),
      projectRoot: '/tmp/nonexistent',
    })
    const config = createConfigService({ assets: assetResolver })
    expect(config.core.daemon.projects.retentionDays).toBe(30)
  })
})
