# variables are expected to be fed via environment variables or cli args
variable "aws_access_key" {}
variable "aws_secret_key" {}
variable "aws_region" {}
variable "app_container_image_tag" {}

module "slack_middleware_service" {
  source  = "rivernews/kubernetes-microservice/digitalocean"
  version = ">= v0.1.17"

  aws_region     = var.aws_region
  aws_access_key = var.aws_access_key
  aws_secret_key = var.aws_secret_key
  cluster_name   = "project-shaungc-digitalocean-cluster"
  node_pool_name = "project-shaungc-digitalocean-node-pool"
  scale = local.slk_scale

  app_label               = "slack-middleware-service"
  app_exposed_port        = 8002
  app_deployed_domain     = "slack.api.shaungc.com"
  cors_domain_whitelist   = []
  app_container_image     = "shaungc/slack-middleware-service"
  app_container_image_tag = var.app_container_image_tag
  app_secret_name_list = [
    "/provider/aws/account/iriversland2-15pro/AWS_ACCESS_KEY_ID",
    "/provider/aws/account/iriversland2-15pro/AWS_SECRET_ACCESS_KEY",
    "/app/slack-middleware-service/AWS_S3_ARCHIVE_BUCKET_NAME",
    "/provider/digitalocean/DIGITALOCEAN_ACCESS_TOKEN",

    "/service/glassdoor/GLASSDOOR_USERNAME",
    "/service/glassdoor/GLASSDOOR_PASSWORD",

    "/app/slack-middleware-service/NODE_ENV",
    "/app/slack-middleware-service/HOST",
    "/app/slack-middleware-service/PORT",
    "/app/slack-middleware-service/SLACK_TOKEN_OUTGOING_LAUNCH",
    "/app/slack-middleware-service/SLACK_TOKEN_OUTGOING_LIST_ORG",
    "/app/slack-middleware-service/SLACK_TOKEN_INCOMING_URL",
    "/app/slack-middleware-service/TRAVIS_TOKEN",

    "/database/redis_cluster_kubernetes/REDIS_HOST",
    "/database/redis_cluster_kubernetes/REDIS_PORT",
    "/database/redis_cluster_kubernetes/REDIS_PASSWORD",

    "/app/slack-middleware-service/SUPERVISOR_PUBSUB_REDIS_DB",
    "/app/slack-middleware-service/FLUSHDB_ON_START",

    "/app/slack-middleware-service/TRAVIS_SCRAPER_JOB_REPORT_INTERVAL_TIMEOUT_MS",

    # for scraper in k8 jobs
    "/service/selenium-service/SELENIUM_SERVER_HOST"
  ]

  environment_variables = {
    S3_DISPATCH_JOB_INTERVAL_MS = "5000"

    # smaller job to prevent memory leak / RAM consumption going too high
    # when `1000`, resulting in around 399 jobs -> when job failed, cost more and take longer to retry
    # when `500`, resulting around 753 jobs -> more job changes shift and when so, more likely to have overlap in node and memory consumption can spike high
    # when `300`, got around 12~1300 jobs
    SCRAPER_JOB_SPLITTING_SIZE = "300"

    CROSS_SESSION_TIME_LIMIT_MINUTES = "45"
    
    # total jobs
    SELENIUM_ARCHITECTURE_TYPE = "pod-standalone"

    SLK_REPLICA = tostring(local.slk_scale)
    
    # this number is only within each replica, the total worker nodes are
    # SLK_REPLICA * SCRAPER_WORKER_NODE_COUNT
    # `22` may cause memory pressure on SLK on a 4v8G machine, especially when accessing grafana
    SCRAPER_WORKER_NODE_COUNT = "15"
    
    SCRAPER_COUNT_PER_WORKER_NODE = "3"

    SCRAPER_DRIVER_NDOE_MEMORY_REQUEST = "200Mi"
    SCRAPER_DRIVER_NDOE_MEMORY_LIMIT = "1000Mi"
    SCRAPER_DRIVER_NDOE_CPU_REQUEST = ".2"
    SCRAPER_DRIVER_NDOE_CPU_LIMIT = ".6"
  }

  use_recreate_deployment_strategy = true
}

locals {
  slk_scale = 1
}

# module "selenium_service" {
#   source  = "rivernews/kubernetes-microservice/digitalocean"
#   version = ">= v0.1.14"

#   aws_region     = var.aws_region
#   aws_access_key = var.aws_access_key
#   aws_secret_key = var.aws_secret_key
#   cluster_name   = "project-shaungc-digitalocean-cluster"

#   app_label                = "selenium-service"
#   app_exposed_port         = 4444

#   # Docker Selenium
#   # https://github.com/SeleniumHQ/docker-selenium
#   app_container_image     = "selenium/standalone-chrome"
#   app_container_image_tag = "3.141.59-zirconium"

#   use_recreate_deployment_strategy = true
  
#   share_host_memory = true

#   # specifying unit
#   # https://kubernetes.io/docs/concepts/configuration/manage-compute-resources-container/#meaning-of-memory
#   memory_guaranteed = "128Mi"
#   memory_max_allowed = "6.5G"
# }

// See the logs of production server
// logs
// ./cicd$ KUBECONFIG=kubeconfig.yaml kubectl -n slack-middleware-service logs --follow deploy/slack-middleware-service-deployment
// logs & write to file
// https://askubuntu.com/questions/420981/how-do-i-save-terminal-output-to-a-file
// ./cicd$ KUBECONFIG=kubeconfig.yaml kubectl -n slack-middleware-service logs --follow deploy/slack-middleware-service-deployment 2>&1 | tee server.log
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
