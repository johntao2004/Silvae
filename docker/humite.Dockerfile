FROM node:22-bookworm-slim AS web-build
WORKDIR /workspace
ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY design design
COPY scripts scripts
COPY apps/web apps/web
COPY apps/server/src/main/resources/role-permissions.json apps/server/src/main/resources/role-permissions.json
COPY apps/server/src/main/resources/catalog apps/server/src/main/resources/catalog
RUN pnpm build

FROM eclipse-temurin:21-jdk-noble AS server-build
WORKDIR /workspace
COPY apps/server apps/server
COPY docs/openapi docs/openapi
COPY --from=web-build /workspace/apps/web/dist/client apps/server/src/main/resources/static
RUN cd apps/server && ./mvnw -q -DskipTests package

FROM eclipse-temurin:21-jre-noble
RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /library/main /var/lib/humite/fonts /var/lib/humite/content/articles /var/lib/humite/content/vault /var/lib/humite/keys /tmp/humite \
    && chown -R 1000:1000 /app /library /var/lib/humite /tmp/humite \
    && chmod -R 0775 /library /var/lib/humite /tmp/humite
WORKDIR /app
COPY --chmod=0755 docker/entrypoint.sh /app/entrypoint.sh
COPY --chmod=0644 --from=server-build /workspace/apps/server/target/humite-0.1.0-SNAPSHOT.jar /app/humite.jar
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -Djava.io.tmpdir=/tmp/humite"
ENTRYPOINT ["/app/entrypoint.sh"]
