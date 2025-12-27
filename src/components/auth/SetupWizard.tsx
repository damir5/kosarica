import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { createSuperadmin } from '@/lib/auth-server'
import { authClient } from '@/lib/auth-client'

type Step = 'credentials' | 'passkey' | 'complete'

export function SetupWizard() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('credentials')
  const [formData, setFormData] = useState({ email: '', password: '', name: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passkeySupported, setPasskeySupported] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(setPasskeySupported)
        .catch(() => setPasskeySupported(false))
    }
  }, [])

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await (createSuperadmin as (data: typeof formData) => Promise<{ success: boolean }>)(formData)

      // Sign in immediately after creation
      await authClient.signIn.email({
        email: formData.email,
        password: formData.password,
      })

      if (passkeySupported) {
        setStep('passkey')
      } else {
        setStep('complete')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePasskeySetup = async () => {
    setLoading(true)
    try {
      await authClient.passkey.addPasskey({
        name: 'Superadmin Passkey',
      })
      setStep('complete')
    } catch (err) {
      console.error('Passkey setup failed:', err)
      setStep('complete')
    } finally {
      setLoading(false)
    }
  }

  const handleSkipPasskey = () => setStep('complete')

  const handleComplete = () => navigate({ to: '/' })

  if (step === 'credentials') {
    return (
      <div className="w-full max-w-md p-8 rounded-xl bg-zinc-900 border border-zinc-700">
        <h1 className="text-2xl font-bold text-white mb-2">Welcome to Kosarica</h1>
        <p className="text-zinc-400 mb-6">Create your superadmin account to get started.</p>

        <form onSubmit={handleCredentialsSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-zinc-300 mb-1">
              Name
            </label>
            <input
              id="name"
              type="text"
              placeholder="Your name"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 text-white border border-zinc-600 focus:border-blue-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="admin@example.com"
              value={formData.email}
              onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
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
              placeholder="Min 8 characters"
              value={formData.password}
              onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 text-white border border-zinc-600 focus:border-blue-500 focus:outline-none"
              minLength={8}
              required
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? 'Creating account...' : 'Create Superadmin Account'}
          </button>
        </form>
      </div>
    )
  }

  if (step === 'passkey') {
    return (
      <div className="w-full max-w-md p-8 rounded-xl bg-zinc-900 border border-zinc-700 text-center">
        <div className="text-4xl mb-4">🔐</div>
        <h2 className="text-2xl font-bold text-white mb-2">Secure Your Account</h2>
        <p className="text-zinc-400 mb-6">
          Add a passkey for passwordless login using biometrics or a security key.
        </p>

        <div className="space-y-3">
          <button
            onClick={handlePasskeySetup}
            disabled={loading}
            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? 'Setting up...' : 'Add Passkey'}
          </button>
          <button
            onClick={handleSkipPasskey}
            disabled={loading}
            className="w-full py-3 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md p-8 rounded-xl bg-zinc-900 border border-zinc-700 text-center">
      <div className="text-green-400 text-5xl mb-4">✓</div>
      <h2 className="text-2xl font-bold text-white mb-2">Setup Complete!</h2>
      <p className="text-zinc-400 mb-6">Your superadmin account is ready.</p>
      <button
        onClick={handleComplete}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
      >
        Go to Dashboard
      </button>
    </div>
  )
}
