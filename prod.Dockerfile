# ngrok not working on alpine
FROM node:13.7-alpine3.11

# FROM node:13-slim as build_stage

ENV NODE_SRC_ROOT=/usr/src
ENV NODE_SERVER_ROOT=${NODE_SRC_ROOT}/server
ENV NODE_DIST_ROOT=${NODE_SRC_ROOT}/dist

WORKDIR ${NODE_SRC_ROOT}

RUN mkdir -p ${NODE_SRC_ROOT}

COPY src/ ${NODE_SRC_ROOT}/

# install packages earlier in dockerfile
# so that it is cached and don't need to re-build
# when yoru source code change
# RUN pwd && rm package-lock.json && ls -la && npm i && npm run build && ls -la
RUN pwd \
    && ls -la \
    && npm ci --only=production \
    && npm run build-ts-production




# FROM node:13.7-alpine3.11

# ENV NODE_SRC_ROOT=/usr/src
# ENV NODE_DIST_ROOT=${NODE_SRC_ROOT}/dist
# WORKDIR ${NODE_DIST_ROOT}
# RUN mkdir -p ${NODE_DIST_ROOT}

# COPY --from=build_stage ${NODE_DIST_ROOT}/ ${NODE_DIST_ROOT}/

CMD ["node", "/usr/src/dist/index.js"]
