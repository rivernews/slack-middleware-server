docker run --rm -v $(pwd):$(pwd) -w $(pwd) shaungc/terraform-kubectl-image init -backend-config=local.backend.credentials.tfvars
