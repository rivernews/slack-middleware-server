
set -e

cd src
npm i
DIGITALOCEAN_ACCESS_TOKEN=$DIGITALOCEAN_ACCESS_TOKEN doctl auth init
mkdir -p ~/.kube
doctl k8s cluster kubeconfig show project-shaungc-digitalocean-cluster > ~/.kube/config

# https://github.com/romkatv/powerlevel10k#configuration-wizard
p10k configure
