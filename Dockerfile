# Petto, for a second instance (a VPS, any machine with Docker): `docker build -t petto-bot .`
# The JavaScript that TypeScript produces is committed, so the image does not compile anything: it installs the production dependencies and runs index.js.
# Nothing secret is baked in: the settings come from the environment when the container starts (see docker-compose.worker.yml and docs/SECOND_INSTANCE.md).
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# The dependencies first, so a change in the code does not install them again.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Not as root.
RUN chown -R node:node /app
USER node

# The same command as Discloud's `npm run start` (a 768 MB heap).
CMD ["node", "--max-old-space-size=768", "index.js"]
