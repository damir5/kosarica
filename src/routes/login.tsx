import { createFileRoute, redirect } from '@tanstack/react-router'
import { checkSetupRequired, getSession } from '@/lib/auth-server'
import { LoginForm } from '@/components/auth/LoginForm'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    // Redirect to setup if no users exist
    const needsSetup = await checkSetupRequired()
    if (needsSetup) {
      throw redirect({ to: '/setup' as const })
    }

    // Redirect to home if already logged in
    const session = await getSession()
    if (session) {
      throw redirect({ to: '/' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 to-black p-4">
      <LoginForm />
    </div>
  )
}
