# variables are expected to be fed via environment variables or cli args
variable "aws_access_key" {}
variable "aws_secret_key" {}
variable "aws_region" {}
variable "app_container_image_tag" {}

module "slack_middleware_service" {
  source  = "rivernews/kubernetes-microservice/digitalocean"
  version = "v0.0.9"

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
    "/app/slack-middleware-service/NODE_ENV",
    "/app/slack-middleware-service/HOST",
    "/app/slack-middleware-service/PORT",
    "/app/slack-middleware-service/SLACK_TOKEN_OUTGOING_LAUNCH",
    "/app/slack-middleware-service/SLACK_TOKEN_OUTGOING_LIST_ORG",
    "/app/slack-middleware-service/SLACK_TOKEN_INCOMING_URL",
    "/app/slack-middleware-service/TRAVIS_TOKEN",

    "/database/redis_cluster_kubernetes/REDIS_HOST",
    "/database/redis_cluster_kubernetes/REDIS_PORT",
    "/app/slack-middleware-service/SUPERVISOR_PUBSUB_REDIS_DB"
  ]
}

// See the logs of production server
// ./cicd$ KUBECONFIG=kubeconfig.yaml kubectl -n slack-middleware-service logs --follow deploy/slack-middleware-service-deployment
