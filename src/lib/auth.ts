import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { passkey } from '@better-auth/passkey'
import { getDb, getEnv } from '@/utils/bindings'
import * as schema from '@/db/schema'

export function createAuth() {
  const env = getEnv()
  const db = getDb()

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',

    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        passkey: schema.passkey,
      },
    }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },

    plugins: [
      passkey({
        rpID: env.PASSKEY_RP_ID || 'localhost',
        rpName: env.PASSKEY_RP_NAME || 'Kosarica App',
        origin: env.BETTER_AUTH_URL || 'http://localhost:3000',
      }),
    ],

    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'user',
          input: false,
        },
      },
    },
  })
}

// Lazy-initialized auth instance
let authInstance: ReturnType<typeof createAuth> | null = null

export function getAuth() {
  if (!authInstance) {
    authInstance = createAuth()
  }
  return authInstance
}

// For backwards compatibility - use getAuth() in server handlers
export const auth = {
  get api() {
    return getAuth().api
  },
  get $Infer() {
    return getAuth().$Infer
  },
  get handler() {
    return getAuth().handler
  },
}

export type Session = ReturnType<typeof createAuth>['$Infer']['Session']
