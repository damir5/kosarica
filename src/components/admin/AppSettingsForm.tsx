import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface AppSettings {
  appName: string | null
}

interface AppSettingsFormProps {
  settings: AppSettings | null
  onSave: (settings: Partial<AppSettings>) => Promise<void>
  isLoading?: boolean
}

export function AppSettingsForm({ settings, onSave, isLoading }: AppSettingsFormProps) {
  const [appName, setAppName] = useState(settings?.appName || '')

  useEffect(() => {
    if (settings?.appName) {
      setAppName(settings.appName)
    }
  }, [settings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave({ appName })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App Settings</CardTitle>
        <CardDescription>
          Configure general application settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="appName" className="text-sm font-medium">
              App Name
            </label>
            <Input
              id="appName"
              className="mt-2"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="Enter app name"
            />
            <p className="mt-1 text-sm text-muted-foreground">
              The name displayed throughout the application.
            </p>
          </div>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
