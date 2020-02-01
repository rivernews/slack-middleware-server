# ngrok not working on alpine
# FROM node:13.7-alpine3.11

FROM node:13

ENV NODE_SRC_ROOT=/usr/src
ENV NODE_SERVER_ROOT=${NODE_SRC_ROOT}/server

WORKDIR ${NODE_SRC_ROOT}

COPY package*.json ${NODE_SRC_ROOT}/

# install packages earlier in dockerfile
# so that it is cached and don't need to re-build
# when yoru source code change
RUN npm ci --only=production

RUN mkdir -p $NODE_SERVER_ROOT

COPY server/ ${NODE_SERVER_ROOT}/

CMD ["node", "/usr/src/server/index.js"]