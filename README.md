# Slack Middleware Service

[![Build Status](https://travis-ci.com/rivernews/slack-middleware-server.svg?branch=master)](https://travis-ci.com/rivernews/slack-middleware-server)

This server act as a middleware between Slack API and our glassdoor scrapers. It enables using slack to trigger some cool task on the cloud 🚀 - scraping data from glassdoor! Another important role is it manages distributed workload to scrape at scale.

Here is a diagram summarizing how each component interact
![glassdoor scraper system diagram](https://iriversland2-media.s3.amazonaws.com/editor_uploads/case-studies/2020-11-23-46/glassdoor-scraper-diagram.png)

Relevant repositories:

- **[Selenium Scraper (in Java)](https://github.com/rivernews/review-scraper-java-development-environment)**: the actual scraper that interacts with the webpage, and outputs modeled data to S3. Also reports its status and sync state with Slack Middleware Service using Redis and PubSub.
- **[Kubernetes Head Service (in Golang)](https://github.com/rivernews/k8s-cluster-head-service)**: a separate service living outside of kubernetes cluster, which is used to dynamically scale up the entire k8 cluster and launch jobs. Once jobs finished, it scales down the entire cluster and saves us enormous amount of cost!
- **[Supervisor Portal (in React/TypeScript)](https://github.com/rivernews/supervisor-scraper-job-queue)**: provide UI for job observability, and help manage jobs, i.e., start single, start in batch, abort, progress monitoring, error message check etc.


### How to run locally

- `npm i`
- `npm run dev` will start the server.

#### How to develop
- If not planning to use hot-reload, then always run `npm run dev`, when you finish making code changes and ready to test, abort the process and re-run `npm run dev` manually.
- If you want to have hot-reload server for code change, run `npm run fast-dev`, just make sure everytime we save file to refresh, wait till the resources get clean up before saving file again. Seems this will clean up things correctly and redis client connection doesn't surge.
  - Avoid using `npm run watch`, since we observed a surge in redis client connection. See issue #88.

Some previous notes:
- `npx ts-node-dev --respawn --transpileOnly index.ts` for fast, auto-reload dev server, using [`ts-node-dev`](https://www.npmjs.com/package/ts-node-dev). **However when you press ^C, it will not gracefully exit; ** gracefully exiting only works in watching.
    - In case above doesn't work, you can also try `npx nodemon --ext ts --signal SIGTERM --exec 'ts-node index.ts'` for auto-reload dev server.
- To log in terminal and write to file at the same time, run `kubectl -n slack-middleware-service logs --follow deploy/slack-middleware-service-deployment 2>&1 | tee server.log`
- To inspect redis content, you can run `npx redis-commander --redis-host api.shaungc.com --redis-port 6378 --redis-password REDIS_PASSWORD --redis-db 5`

### How to deploy
- Commit and push to `master`, then also merge and push to `release`
- Make sure Travis build the `master` job - this one will build the SLK image used by Kubernetes deployment. The `release` branch will not trigger docker build on Travis.

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
