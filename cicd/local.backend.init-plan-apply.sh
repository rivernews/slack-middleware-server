docker run --rm -v $(pwd):$(pwd) -w $(pwd) --env ZSH=${ZSH} shaungc/terraform-kubectl-image bash -c '\
terraform init -backend-config=local.backend.credentials.tfvars \
&& terraform apply -auto-approve \
&& terraform -v \
'
