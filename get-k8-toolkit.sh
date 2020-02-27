#!/usr/bin/env sh

set -e

docker run --rm --env=DIGITALOCEAN_ACCESS_TOKEN=${DIGITALOCEAN_ACCESS_TOKEN} digitalocean/doctl:1.38.0 k8s cluster kubeconfig show project-shaungc-digitalocean-cluster > kubeconfig.yaml

curl -LO https://storage.googleapis.com/kubernetes-release/release/v1.15.2/bin/linux/amd64/kubectl
sudo chmod +x ./kubectl
