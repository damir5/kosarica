import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { redirect } from '@tanstack/react-router'
import { count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from './auth'
import { db } from '@/db'
import { user } from '@/db/schema'

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  if (!headers) return null

  const session = await auth.api.getSession({
    headers: headers as unknown as Headers,
  })
  return session
})

export const checkSetupRequired = createServerFn({ method: 'GET' }).handler(
  async () => {
    const result = await db.select({ count: count() }).from(user)
    return result[0].count === 0
  },
)

const superadminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
})

type SuperadminInput = z.infer<typeof superadminSchema>

// Server function to create superadmin account
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createSuperadmin = createServerFn({ method: 'POST' }).handler(
  async (input: any) => {
    const data = superadminSchema.parse(input) as SuperadminInput

    // Verify no users exist (security check)
    const result = await db.select({ count: count() }).from(user)
    if (result[0].count > 0) {
      throw new Error('Setup already completed')
    }

    // Create superadmin account via Better Auth
    const headers = getRequestHeaders()
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email: data.email,
        password: data.password,
        name: data.name,
      },
      headers: headers as unknown as Headers,
    })

    if (!signUpResult) {
      throw new Error('Failed to create superadmin')
    }

    // Update user role to superadmin
    await db.update(user).set({ role: 'superadmin' }).where(eq(user.email, data.email))

    return { success: true }
  },
)

export const requireAuth = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) {
    throw redirect({ to: '/login' as const })
  }
  return session
})

export const requireSuperadmin = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getSession()
    if (!session || (session.user as Record<string, unknown>).role !== 'superadmin') {
      throw redirect({ to: '/login' as const })
    }
    return session
  },
)
