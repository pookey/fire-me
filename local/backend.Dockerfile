FROM node:22-alpine

WORKDIR /app

RUN npm install -g tsx

# Dependencies are installed from package.json alone (package-lock.json is
# gitignored) and kept out of /app/src so compose can bind-mount ./backend/src
# over /app/src without hiding node_modules.
COPY package.json ./
RUN npm install

COPY src ./src

EXPOSE 3000

# `tsx watch` restarts the server when a bind-mounted source file changes.
CMD ["tsx", "watch", "--clear-screen=false", "src/local/server.ts"]
