# The API image. Runs anywhere that takes a container — Render, Railway, Fly,
# Cloud Run — and needs nothing but the environment variables in .env.example.
#
#   docker build -f backend/Dockerfile -t class-manager-api .   # from the repo root
#   docker run -p 3000:3000 --env-file backend/.env class-manager-api
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Every workspace manifest has to be present for `npm ci` to resolve the tree,
# even the ones whose source never makes it into the image.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev

COPY shared shared
COPY backend backend

# Hosts that inject their own $PORT override this; Fastify already binds 0.0.0.0.
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "backend"]
