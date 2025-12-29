import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'

export function LoginForm() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passkeyAvailable, setPasskeyAvailable] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      const checkPasskey = window.PublicKeyCredential.isConditionalMediationAvailable
      if (checkPasskey) {
        checkPasskey().then((available) => {
          if (available) {
            setPasskeyAvailable(true)
          }
        })
      }
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      })

      if (result.error) {
        throw new Error(result.error.message)
      }

      navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePasskeyLogin = async () => {
    setError(null)
    setLoading(true)
    try {
      const result = await authClient.signIn.passkey()
      if (result?.error) {
        throw new Error(result.error.message)
      }
      navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md p-8 rounded-xl bg-zinc-900 border border-zinc-700">
      <h1 className="text-2xl font-bold text-white mb-6">Sign In</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username webauthn"
            className="w-full px-4 py-3 rounded-lg bg-zinc-800 text-white border border-zinc-600 focus:border-blue-500 focus:outline-none"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-zinc-300 mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full px-4 py-3 rounded-lg bg-zinc-800 text-white border border-zinc-600 focus:border-blue-500 focus:outline-none"
            required
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      {passkeyAvailable && (
        <div className="mt-4 pt-4 border-t border-zinc-700">
          <button
            onClick={handlePasskeyLogin}
            disabled={loading}
            className="w-full py-3 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <span>🔐</span>
            <span>Sign in with Passkey</span>
          </button>
        </div>
      )}
    </div>
  )
}
