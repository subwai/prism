import type { Config } from '@react-router/dev/config';

export default {
  appDirectory: 'src',
  buildDirectory: '../../out/renderer',
  // Scans the client entry and route modules for dependencies before the first page load. Without
  // it, Vite finds them mid-load on a cold cache, re-bundles, and the stale imports fail with 504
  // before its HMR client connects, so the reload it sends never arrives.
  future: { unstable_optimizeDeps: true },
  ssr: false,
} satisfies Config;
