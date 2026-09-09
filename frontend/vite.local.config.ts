import { mergeConfig, normalizePath, type Plugin } from 'vite';
import baseConfig from './vite.config';

// Swaps utils/auth.ts for the Cognito-free stub in src/local/auth.ts.
//
// A resolveId hook rather than resolve.alias: an alias matches the import
// specifier string, so it would catch '../utils/auth' from pages/ but miss
// api.ts's './auth' (and any future barrel or path alias). Resolving first and
// comparing the resulting file path catches every route to the module.
function stubAuthPlugin(): Plugin {
  let realAuth = '';
  let stubAuth = '';
  return {
    name: 'local-stub-auth',
    // Must run before vite:resolve, which otherwise settles the id first.
    enforce: 'pre',
    configResolved(config) {
      // Vite resolves to posix absolute paths on every platform, so normalise
      // ours the same way before comparing.
      realAuth = normalizePath(`${config.root}/src/utils/auth.ts`);
      stubAuth = normalizePath(`${config.root}/src/local/auth.ts`);
    },
    async resolveId(source, importer, options) {
      // Entry points and virtual modules can't be an import of auth.ts.
      if (!importer || source.startsWith('\0')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      // Strip ?query so e.g. `?t=<timestamp>` HMR ids still match.
      const id = resolved.id.split('?')[0];
      return id === realAuth ? stubAuth : null;
    },
  };
}

export default mergeConfig(baseConfig, {
  plugins: [stubAuthPlugin()],
  server: {
    // Bind to all interfaces so the port is reachable from outside the container.
    host: true,
    port: 5173,
  },
});
