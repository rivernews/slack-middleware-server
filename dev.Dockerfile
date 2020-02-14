# ngrok not working on alpine
# FROM node:13.7-alpine3.11

FROM node:13-slim

ENV WORKSPACE=${OLDPWD:-/root}

WORKDIR ${WORKSPACE}

# install packages earlier in dockerfile
# so that it is cached and don't need to re-build
# when your source code change

# install powerlevel10k for better command line experience
ENV TERM=${TERM}
ENV COLORTERM=${COLORTERM}
RUN apt-get update -y \
  && apt-get install software-properties-common -y \
  && add-apt-repository ppa:git-core/ppa -y \
  && apt-get install -y git zsh \
  && git --version \
  && git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ~/powerlevel10k \
  && echo "source ~/powerlevel10k/powerlevel10k.zsh-theme" >>~/.zshrc \
  && cd ~/powerlevel10k \
  && exec zsh
  # you have to install fonts on your laptop (where your IDE editor/machine is running on) instead of inside the container

COPY src/package*.json ${WORKSPACE}/
RUN npm install

# do not copy any source file while using vscode remote container
# since vscode will automatically mount source file into container
# if you copy over the source code, editing on them will not
# reflect outside of the container and can lose your file change
