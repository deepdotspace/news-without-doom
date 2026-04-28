import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import generouted from '@generouted/react-router/plugin'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  plugins: [react(), generouted(), cloudflare()],
  resolve: {
    dedupe: ['react', 'react-dom', 'better-auth', 'framer-motion'],
  },
  optimizeDeps: {
    // Make sure framer-motion shares the app's React instance — without
    // explicit inclusion the dep optimizer can ship a bundled copy that
    // creates a separate React context, breaking hooks.
    include: ['framer-motion', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
})
