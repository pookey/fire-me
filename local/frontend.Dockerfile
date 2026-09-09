# Build context is ./frontend. Compose bind-mounts that directory over /app
# with an anonymous volume on /app/node_modules, so the image's node_modules
# (Linux binaries) survive while source edits hot-reload from the host.
FROM node:22-alpine

WORKDIR /app

# No package-lock.json is committed, so `npm install` rather than `npm ci`.
# The npm bundled with node:22 (10.x) crashes with "Cannot read properties of
# null (reading 'edgesOut')" resolving this dependency tree from scratch;
# npm 12 resolves it fine.
COPY package.json ./
RUN npm install -g npm@12 && npm install

# Explicit COPYs instead of `COPY . .`: the build context has no .dockerignore,
# so a blanket copy would overwrite the Linux node_modules with the host's
# (darwin esbuild/rollup binaries) and seed the anonymous volume from that.
COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts vite.local.config.ts ./
COPY src ./src

EXPOSE 5173

CMD ["npx", "vite", "--config", "vite.local.config.ts", "--host"]
