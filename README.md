# Slack Middleware Service

[![Build Status](https://travis-ci.com/rivernews/slack-middleware-server.svg?branch=master)](https://travis-ci.com/rivernews/slack-middleware-server)

This server act as a middleware to communicate with Slack API. It enables using slack to trigger some cool task on the cloud 🚀.

### How to run locally

- `npm i`
- `npm run dev` - this will spin up nodemon - a hot-reloading nodejs server for you.
- `npx ts-node-dev --respawn --transpileOnly index.ts` for fast, auto-reload dev server, using [`ts-node-dev`](https://www.npmjs.com/package/ts-node-dev). **However when you press ^C, it will not gracefully exit; ** gracefully exiting only works in watching.
    - In case above doesn't work, you can also try `npx nodemon --ext ts --signal SIGTERM --exec 'ts-node index.ts'` for auto-reload dev server.
- To log in terminal and write to file at the same time, run `kubectl -n slack-middleware-service logs --follow deploy/slack-middleware-service-deployment 2>&1 | tee server.log`
- To inspect redis content, you can run `npx redis-commander --redis-host api.shaungc.com --redis-port 6378 --redis-password REDIS_PASSWORD --redis-db 5`

### How to test

- `npm test` - that's all, other things (like spinning up / off test server) are all handled for you.

Also will force test upon git push.

### Howo to use

- To trigger S3 job, run `curl -X POST http://localhost:8080/queues/s3-orgs-job?token=`

### How to debug selenium

We use selenium container as pod in each Kubernetes job, so we need to (🛑 Some how this is not working, cannot port forward inside the container):
1. Check out the job name: `kubectl -n selenium-service get jobs -w`
1. Port-forward into job container `kubectl -n selenium-service port-forward job/jobname 5900:5900`
1. Use VNC-Viewer at `localhost:5900`
