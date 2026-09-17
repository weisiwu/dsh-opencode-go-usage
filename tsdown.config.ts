/**
 * Client-half bundler for dsh-opencode-go-usage.
 *
 * One output: lib/client.js — a closure factory handed to
 * `window.__ModuleLoader__.load({ id, factory })`. Platform modules stay
 * external and resolve through the loader's frozen module table; everything
 * else (including this package's own sources) is inlined.
 *
 * The purity gate below makes a cross-plugin value import a build error:
 * `@deepseek-ai/*` value imports that are not platform modules are rejected,
 * so collaboration happens through cordis services only. Type-only imports are
 * erased before this gate and never reach it.
 */
import type { UserConfig } from 'tsdown'

const ID = 'dsh-opencode-go-usage'

/** Module specifiers the DSH web shell shares into its frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-ui-slots',
] as const

export default {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (id: string) => CLIENT_EXTERNALS.includes(id as typeof CLIENT_EXTERNALS[number]) ? undefined : true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source as typeof CLIENT_EXTERNALS[number])) return null
      throw new Error(
        `client bundle purity: ${JSON.stringify(source)} is not a platform module; cross-plugin value imports are forbidden`,
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig
