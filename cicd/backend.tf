terraform {
  backend "s3" {
    bucket = "iriversland-cloud"
    key    = "terraform/slack-middleware-service.remote-terraform.tfstate"
  }
}
