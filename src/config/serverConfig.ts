import { getEnv } from '@/utils/bindings'
import { serverEnvSchema, type ServerEnv } from './schemas'

let cachedConfig: ServerEnv | null = null

export function getServerConfig(): ServerEnv {
  if (cachedConfig) {
    return cachedConfig
  }

  const env = getEnv()

  const result = serverEnvSchema.safeParse({
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
  })

  if (!result.success) {
    throw new Error(`Server environment validation failed: ${result.error.message}`)
  }

  cachedConfig = result.data
  return cachedConfig
}
