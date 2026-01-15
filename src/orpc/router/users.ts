import { procedure } from '../base'
import * as z from 'zod'
import { eq, like, or, count, desc, and, ne } from 'drizzle-orm'
import { getDb } from '@/utils/bindings'
import { user } from '@/db/schema'

export const listUsers = procedure
  .input(
    z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      role: z.enum(['user', 'superadmin']).optional(),
      banned: z.boolean().optional(),
    })
  )
  .handler(async ({ input }) => {
    const db = getDb()
    const offset = (input.page - 1) * input.pageSize

    const conditions = []

    if (input.search) {
      conditions.push(
        or(like(user.name, `%${input.search}%`), like(user.email, `%${input.search}%`))
      )
    }
    if (input.role) {
      conditions.push(eq(user.role, input.role))
    }
    if (input.banned !== undefined) {
      conditions.push(eq(user.banned, input.banned))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [users, totalResult] = await Promise.all([
      db
        .select()
        .from(user)
        .where(whereClause)
        .orderBy(desc(user.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      db
        .select({ count: count() })
        .from(user)
        .where(whereClause),
    ])

    return {
      users,
      total: totalResult[0]?.count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil((totalResult[0]?.count ?? 0) / input.pageSize),
    }
  })

export const getUser = procedure
  .input(z.object({ userId: z.string() }))
  .handler(async ({ input }) => {
    const db = getDb()
    const result = await db.select().from(user).where(eq(user.id, input.userId))
    if (result.length === 0) {
      throw new Error('User not found')
    }
    return result[0]
  })

export const updateUserRole = procedure
  .input(
    z.object({
      userId: z.string(),
      role: z.enum(['user', 'superadmin']),
      currentUserId: z.string(),
    })
  )
  .handler(async ({ input }) => {
    const db = getDb()

    // Prevent self-demotion
    if (input.userId === input.currentUserId && input.role === 'user') {
      throw new Error('You cannot demote yourself')
    }

    // Check if this is the last superadmin
    if (input.role === 'user') {
      const superadminCount = await db
        .select({ count: count() })
        .from(user)
        .where(and(eq(user.role, 'superadmin'), ne(user.id, input.userId)))

      if ((superadminCount[0]?.count ?? 0) === 0) {
        throw new Error('Cannot demote the last superadmin')
      }
    }

    await db
      .update(user)
      .set({ role: input.role, updatedAt: new Date() })
      .where(eq(user.id, input.userId))

    return { success: true }
  })

export const deleteUser = procedure
  .input(
    z.object({
      userId: z.string(),
      currentUserId: z.string(),
    })
  )
  .handler(async ({ input }) => {
    const db = getDb()

    // Prevent self-deletion
    if (input.userId === input.currentUserId) {
      throw new Error('You cannot delete yourself')
    }

    // Check if this is the last superadmin
    const targetUser = await db.select().from(user).where(eq(user.id, input.userId))
    if (targetUser[0]?.role === 'superadmin') {
      const superadminCount = await db
        .select({ count: count() })
        .from(user)
        .where(and(eq(user.role, 'superadmin'), ne(user.id, input.userId)))

      if ((superadminCount[0]?.count ?? 0) === 0) {
        throw new Error('Cannot delete the last superadmin')
      }
    }

    await db.delete(user).where(eq(user.id, input.userId))

    return { success: true }
  })

export const banUser = procedure
  .input(
    z.object({
      userId: z.string(),
      banned: z.boolean(),
      reason: z.string().optional(),
      currentUserId: z.string(),
    })
  )
  .handler(async ({ input }) => {
    const db = getDb()

    // Prevent self-ban
    if (input.userId === input.currentUserId) {
      throw new Error('You cannot ban yourself')
    }

    await db
      .update(user)
      .set({
        banned: input.banned,
        bannedAt: input.banned ? new Date() : null,
        bannedReason: input.banned ? (input.reason ?? null) : null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, input.userId))

    return { success: true }
  })
