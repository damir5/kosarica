// Re-export client config for backwards compatibility
// Server-side config should use getServerConfig() from @/config/serverConfig
export { clientConfig as env } from "@/config/clientConfig";

// Re-export server config for server-side usage
export { getServerConfig } from "@/config/serverConfig";
