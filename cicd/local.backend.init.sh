docker run --rm -v $(pwd):$(pwd) -w $(pwd) shaungc/terraform-kubectl-image bash -c '\
    /bin/terraform init -backend-config=local.backend.credentials.tfvars && \
    /bin/terraform -v \
'
