import { os } from '@orpc/server'
import * as z from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '@/utils/bindings'
import { appSettings } from '@/db/schema'

const DEFAULT_SETTINGS = {
  id: 'main',
  appName: 'Kosarica',
  requireEmailVerification: false,
  minPasswordLength: 8,
  maxPasswordLength: 128,
  passkeyEnabled: true,
  updatedAt: new Date(),
}

export const getSettings = os.input(z.object({})).handler(async () => {
  const db = getDb()
  const settings = await db.select().from(appSettings).where(eq(appSettings.id, 'main'))

  if (settings.length === 0) {
    // Create default settings if they don't exist
    await db.insert(appSettings).values(DEFAULT_SETTINGS)
    return DEFAULT_SETTINGS
  }

  return settings[0]
})

export const updateSettings = os
  .input(
    z.object({
      appName: z.string().min(1).max(100).optional(),
      requireEmailVerification: z.boolean().optional(),
      minPasswordLength: z.number().int().min(6).max(64).optional(),
      maxPasswordLength: z.number().int().min(16).max(256).optional(),
      passkeyEnabled: z.boolean().optional(),
    })
  )
  .handler(async ({ input }) => {
    const db = getDb()

    // Check if settings exist
    const existing = await db.select().from(appSettings).where(eq(appSettings.id, 'main'))

    if (existing.length === 0) {
      // Create with provided values merged with defaults
      await db.insert(appSettings).values({
        ...DEFAULT_SETTINGS,
        ...input,
        updatedAt: new Date(),
      })
    } else {
      // Update existing settings
      await db
        .update(appSettings)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, 'main'))
    }

    // Return updated settings
    const updated = await db.select().from(appSettings).where(eq(appSettings.id, 'main'))
    return updated[0]
  })
