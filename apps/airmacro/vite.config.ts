import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const fromHere = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

// AirMacro — app dédiée ; le code métier partagé vit dans ../../src/macro et ../../server
export default defineConfig({
  root: fromHere('.'),
  plugins: [react()],
  // pré-bundling séparé : les serveurs de dev AirCrypto et AirMacro tournent en même temps
  cacheDir: fromHere('../../node_modules/.vite-airmacro'),
  build: {
    outDir: fromHere('../../dist-airmacro'),
    emptyOutDir: true,
  },
  server: {
    fs: { allow: [fromHere('../..')] },
    // état local des alertes (écrit toutes les 30 s) : hors surveillance
    watch: { ignored: ['**/.data/**'] },
  },
})
