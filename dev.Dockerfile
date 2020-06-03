# ngrok not working on alpine
# FROM node:13.7-alpine3.11

FROM node:13

ENV WORKSPACE=${OLDPWD:-/root}

WORKDIR ${WORKSPACE}

# install packages earlier in dockerfile
# so that it is cached and don't need to re-build
# when your source code change

# install tools that are useful for development
ENV TERM=${TERM}
ENV COLORTERM=${COLORTERM}

ENV TERRAFORM_VERSION=0.12.18
ENV DOCTL_VERSION=1.36.0

# install latest git 2.20, husky requires > X.13
RUN echo "deb http://ftp.debian.org/debian stretch-backports main" | tee /etc/apt/sources.list.d/stretch-backports.list \
  && apt-get update -y \
  && apt-get install -t stretch-backports git -y \
  && git --version \
  #
  # install zsh
  && apt-get install zsh -y \
  # install oh-my-zsh for useful cli alias: https://github.com/ohmyzsh/ohmyzsh
  && sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" \
  # install powerlevel10k
  && git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ~/powerlevel10k \
  && echo "source ~/powerlevel10k/powerlevel10k.zsh-theme" >>~/.zshrc \
  && cd ~/powerlevel10k \
  && exec zsh
  # you have to install fonts on your laptop (where your IDE editor/machine is running on) instead of inside the container


COPY src/package*.json ${WORKSPACE}/
RUN npm install


# https://github.com/microsoft/vscode-dev-containers/tree/master/containers/docker-in-docker
RUN echo "Installing docker CE CLI..." \ 
  && apt-get update \
  && apt-get install -y apt-transport-https ca-certificates curl gnupg-agent software-properties-common lsb-release \
  && curl -fsSL https://download.docker.com/linux/$(lsb_release -is | tr '[:upper:]' '[:lower:]')/gpg | apt-key add - 2>/dev/null \
  && add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/$(lsb_release -is | tr '[:upper:]' '[:lower:]') $(lsb_release -cs) stable" \
  && apt-get update \
  && apt-get install -y docker-ce-cli


RUN echo 'Install deploy tools' && \
  # install terraform
  cd /tmp &&  \
  wget https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip && \
  unzip terraform_${TERRAFORM_VERSION}_linux_amd64.zip -d /usr/bin && \
  # install kubectl
  # https://kubernetes.io/docs/tasks/tools/install-kubectl/#install-kubectl-on-linux
  curl -LO https://storage.googleapis.com/kubernetes-release/release/v1.15.2/bin/linux/amd64/kubectl && \
  mv ./kubectl /usr/bin/kubectl && \
  chmod +x /usr/bin/kubectl && \
  # install doctl
  # https://github.com/digitalocean/doctl#downloading-a-release-from-github
  curl -OL https://github.com/digitalocean/doctl/releases/download/v${DOCTL_VERSION}/doctl-${DOCTL_VERSION}-linux-amd64.tar.gz && \
  tar xf doctl-${DOCTL_VERSION}-linux-amd64.tar.gz --directory /usr/bin


# do not copy any source file while using vscode remote container
# since vscode will automatically mount source file into container
# if you copy over the source code, editing on them will not
# reflect outside of the container and can lose your file change
