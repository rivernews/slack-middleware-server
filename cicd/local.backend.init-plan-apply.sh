docker run --rm -v $(pwd):$(pwd) -w $(pwd) --env ZSH=${ZSH} shaungc/terraform-kubectl-image bash -c '\
/bin/terraform init -backend-config=local.backend.credentials.tfvars \
&& /bin/terraform plan \
&& /bin/terraform apply -auto-approve \
&& /bin/terraform -v \
'
