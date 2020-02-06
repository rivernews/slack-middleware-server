docker run --rm -v $(pwd):$(pwd) -w $(pwd) shaungc/terraform-kubectl-image <<EOL \
terraform init -backend-config=local.backend.credentials.tfvars
EOL
