import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
  ],
  server: {
    // app AirMacro voisine (apps/airmacro) : son état local et son build ne concernent pas AirCrypto
    watch: { ignored: ['**/.data/**', '**/dist-airmacro/**'] },
  },
})
