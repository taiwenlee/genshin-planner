import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { defineConfig } from 'vite'

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/libs/gi/page-resin-planner',
  plugins: [nxViteTsPaths()],
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/gi/page-resin-planner',
      provider: 'v8' as const,
    },
  },
}))
