# variables are expected to be fed via environment variables or cli args
variable "aws_access_key" {}
variable "aws_secret_key" {}
variable "aws_region" {}
variable "app_container_image_tag" {}

module "slack_middleware_service" {
  source  = "rivernews/kubernetes-microservice/digitalocean"
  version = "v0.1.1"

  aws_region     = var.aws_region
  aws_access_key = var.aws_access_key
  aws_secret_key = var.aws_secret_key
  cluster_name   = "project-shaungc-digitalocean-cluster"

  app_label               = "slack-middleware-service"
  app_exposed_port        = 8002
  app_deployed_domain     = "slack.api.shaungc.com"
  cors_domain_whitelist   = []
  app_container_image     = "shaungc/slack-middleware-service"
  app_container_image_tag = var.app_container_image_tag
  app_secret_name_list = [
    "/provider/aws/account/iriversland2-15pro/AWS_ACCESS_KEY_ID",
    "/provider/aws/account/iriversland2-15pro/AWS_SECRET_ACCESS_KEY",

    "/app/slack-middleware-service/NODE_ENV",
    "/app/slack-middleware-service/HOST",
    "/app/slack-middleware-service/PORT",
    "/app/slack-middleware-service/SLACK_TOKEN_OUTGOING_LAUNCH",
    "/app/slack-middleware-service/SLACK_TOKEN_OUTGOING_LIST_ORG",
    "/app/slack-middleware-service/SLACK_TOKEN_INCOMING_URL",
    "/app/slack-middleware-service/TRAVIS_TOKEN",

    "/database/redis_cluster_kubernetes/REDIS_HOST",
    "/database/redis_cluster_kubernetes/REDIS_PORT",

    "/app/slack-middleware-service/SUPERVISOR_PUBSUB_REDIS_DB",
    "/app/slack-middleware-service/SUPERVISOR_JOB_CONCURRENCY",
    "/app/slack-middleware-service/TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS",
    "/app/slack-middleware-service/SCRAPER_JOB_POOL_MAX_CONCURRENCY"
  ]
}

// See the logs of production server
// logs
// ./cicd$ KUBECONFIG=kubeconfig.yaml kubectl -n slack-middleware-service logs --follow deploy/slack-middleware-service-deployment
// exec
// ./cicd$ KUBECONFIG=kubeconfig.yaml kubectl -n slack-middleware-service exec -it deploy/slack-middleware-service-deployment sh
// port-forward
// ./cicd$ KUBECONFIG=kubeconfig.yaml kubectl -n slack-middleware-service port-forward deploy/slack-middleware-service-deployment PORT:PORT

// redis commands
//
// exec into redis cluster:
// KUBECONFIG=kubeconfig.yaml kubectl -n redis-cluster exec -it deploy/redis-cluster-deployment bash
//
// print client IDS where db=5:
// KUBECONFIG=kubeconfig.yaml kubectl -n redis-cluster exec -it deploy/redis-cluster-deployment redis-cli client list | grep db=5 | cut -d ' ' -f 1 | cut -d = -f 2
//
// kill all client where db=5 (run in redis cluster container):
// redis-cli client list | grep db=5 | cut -d ' ' -f 1 | cut -d = -f 2 | awk '{ print "CLIENT KILL ID " $0 }' | redis-cli -x
