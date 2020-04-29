# passing all args over
# https://stackoverflow.com/a/61390489/9814131

# difference between single quote and double quote in shell script
# https://stackoverflow.com/questions/6697753/difference-between-single-and-double-quotes-in-bash

docker run --rm -v $(pwd):$(pwd) -w $(pwd) --env ZSH=${ZSH} shaungc/terraform-kubectl-image bash -c "\
/bin/terraform init -backend-config=local.backend.credentials.tfvars \
&& /bin/terraform destroy -auto-approve $*
"
