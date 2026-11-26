# syntax=docker/dockerfile:1
# Pinpoint Cloud image: whisper.cpp (pinned) + Node 22 runtime.
# Build from the repository root: docker build -f deploy/Dockerfile .
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- whisper.cpp (static, no OpenMP: keeps runtime deps to libstdc++) ----------
FROM ${NODE_IMAGE} AS whisper
ARG WHISPER_CPP_REF=v1.9.6
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_CPP_REF}" https://github.com/ggml-org/whisper.cpp /src/whisper.cpp
RUN cmake -S /src/whisper.cpp -B /src/whisper.cpp/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DGGML_NATIVE=OFF \
      -DGGML_OPENMP=OFF \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_EXAMPLES=ON \
      -DWHISPER_BUILD_SERVER=OFF \
 && cmake --build /src/whisper.cpp/build --config Release -j4 --target whisper-cli

# ---------- whisper model (pinned commit + sha256) ----------
FROM ${NODE_IMAGE} AS model
ARG WHISPER_MODEL_COMMIT=5359861c739e955e79d9a303bcbc70fb988958b1
ARG WHISPER_MODEL_SHA256=a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002
ARG WHISPER_MODEL_BYTES=147964211
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /models \
 && curl -fsSL --retry 3 --retry-delay 2 \
      -o /models/ggml-base.en.bin \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_COMMIT}/ggml-base.en.bin" \
 && echo "${WHISPER_MODEL_SHA256}  /models/ggml-base.en.bin" | sha256sum -c - \
 && test "$(stat -c%s /models/ggml-base.en.bin)" = "${WHISPER_MODEL_BYTES}"

# ---------- production dependencies ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app/apps/server
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The server runs TypeScript sources directly (tsx); install it outside the prod tree.
RUN npm install --global --prefix /opt/tsx tsx@4.19.0 && npm cache clean --force

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOME=/tmp \
    PATH=/opt/tsx/bin:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 pinpoint \
 && useradd --system --uid 10001 --gid pinpoint --home-dir /home/pinpoint --create-home pinpoint

COPY --from=whisper /src/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=model /models/ggml-base.en.bin /models/ggml-base.en.bin
COPY --from=deps /opt/tsx /opt/tsx

WORKDIR /app
# The TypeScript sources use ESM imports with .js specifiers that tsx maps to
# .ts. Without a package boundary at the image root, tsx treats files outside
# apps/server (shared/contract.ts) as CommonJS and named imports fail.
RUN printf '{"type":"module"}\n' > /app/package.json
COPY --chown=10001:10001 apps/server/package.json apps/server/tsconfig.json /app/apps/server/
COPY --from=deps --chown=10001:10001 /app/apps/server/node_modules /app/apps/server/node_modules
COPY --chown=10001:10001 apps/server/src /app/apps/server/src
COPY --chown=10001:10001 shared /app/shared
COPY --chown=10001:10001 demo/fixtures /app/demo/fixtures
COPY --chown=10001:10001 demo/sample /app/demo/sample

RUN mkdir -p /data && chown 10001:10001 /data
USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["tsx", "apps/server/src/index.ts"]
