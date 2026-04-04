FROM node:24-bookworm

RUN apt-get update \
&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
ca-certificates \
curl \
git \
gosu \
procps \
python3 \
build-essential \
zip \
libnspr4 \
libnss3 \
libdbus-1-3 \
libatk1.0-0 \
libatk-bridge2.0-0 \
libcups2 \
libatspi2.0-0 \
libxcomposite1 \
libxdamage1 \
libxfixes3 \
libxrandr2 \
libgbm1 \
libxkbcommon0 \
libasound2 \
&& rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

ARG OPENCLAW_VERSION=2026.4.2
ARG CLAWHUB_VERSION=latest
RUN npm install -g "openclaw@${OPENCLAW_VERSION}" "clawhub@${CLAWHUB_VERSION}"

RUN mkdir -p /openclaw \
&& ln -sfn /usr/local/lib/node_modules/openclaw/dist /openclaw/dist

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --no-frozen-lockfile
RUN pnpm exec playwright install chromium

COPY src ./src
COPY --chmod=755 entrypoint.sh ./entrypoint.sh

RUN useradd -m -s /bin/bash openclaw \
&& chown -R openclaw:openclaw /app \
&& mkdir -p /data && chown openclaw:openclaw /data \
&& mkdir -p /home/linuxbrew/.linuxbrew && chown -R openclaw:openclaw /home/linuxbrew

USER openclaw
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"
ENV HOMEBREW_PREFIX="/home/linuxbrew/.linuxbrew"
ENV HOMEBREW_CELLAR="/home/linuxbrew/.linuxbrew/Cellar"
ENV HOMEBREW_REPOSITORY="/home/linuxbrew/.linuxbrew/Homebrew"

ENV PORT=8080
ENV OPENCLAW_ENTRY=/usr/local/lib/node_modules/openclaw/dist/entry.js
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
CMD curl -f http://localhost:8080/setup/healthz || exit 1

USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENTRYPOINT ["./entrypoint.sh"]
