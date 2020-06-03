#!/usr/bin/env bash

set -e

# tf remote backend types doc: https://www.terraform.io/docs/backends/types/pg.html
# tf partial backend config: https://www.terraform.io/docs/backends/config.html
# tf doc env var: https://www.terraform.io/docs/configuration/variables.html#environment-variables

# use s3 for remote state

# for avoiding secrets recorded in shell history
# https://unix.stackexchange.com/a/10923
set +o history

echo ""
echo ""
echo "In travisCI"
env

if [ "$TRAVIS_BRANCH" == "release" ];
then
    SHORT_TRAVIS_COMMIT=latest
fi

docker run --rm -v $(pwd):$(pwd) -w $(pwd) \
--env TF_VAR_aws_access_key=${TF_VAR_aws_access_key} \
--env TF_VAR_aws_secret_key=${TF_VAR_aws_secret_key} \
--env TF_VAR_aws_region=${TF_VAR_aws_region} \
--env TF_BACKEND_region=${TF_BACKEND_region} \
--env SHORT_TRAVIS_COMMIT=${SHORT_TRAVIS_COMMIT} \
shaungc/terraform-kubectl-image bash -c '\
    echo "" \
    && echo "" \
    && echo "Inside terraform temp container" \
    && env \
    && terraform init \
        -backend-config="access_key=${TF_VAR_aws_access_key}" \
        -backend-config="secret_key=${TF_VAR_aws_secret_key}" \
        -backend-config="region=${TF_BACKEND_region}" \
    && terraform validate \
    && terraform apply -auto-approve -var="app_container_image_tag=${SHORT_TRAVIS_COMMIT}" \
'

set -o history
