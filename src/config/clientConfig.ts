// Client-side config (VITE_ prefixed variables)
// These are replaced at build time by Vite
export const clientConfig = {
  VITE_APP_NAME: import.meta.env.VITE_APP_NAME || 'Kosarica',
}
