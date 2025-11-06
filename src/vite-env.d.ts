// FIX: Removed reference to "vite/client" to prevent type definition errors.

interface ImportMetaEnv {
  // Add other environment variables here
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}