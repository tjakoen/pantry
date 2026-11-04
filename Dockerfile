# The always-on PANTRY hub. See docker-compose.yml for how it is run and why the code is mounted at
# the same absolute path as on the host.
FROM oven/bun:1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
ENV PANTRY_TRUST_CONTAINER_NETWORK=1
EXPOSE 4400-4449
CMD ["bun", "/app/cli.ts", "hub"]
