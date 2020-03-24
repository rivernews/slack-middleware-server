terraform {
  backend "s3" {
    bucket = "iriversland-cloud"
    key    = "terraform/kubernetes/slack-middleware-service.remote-terraform.tfstate"
  }
}
