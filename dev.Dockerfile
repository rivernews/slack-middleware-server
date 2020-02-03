# ngrok not working on alpine
# FROM node:13.7-alpine3.11

FROM node:13-slim

ENV WORKSPACE=${OLDPWD:-/root}

WORKDIR ${WORKSPACE}

# install packages earlier in dockerfile
# so that it is cached and don't need to re-build
# when yoru source code change
COPY package*.json ${WORKSPACE}/
RUN npm install

# do not copy any source file while using vscode remote container
# since vscode will automatically mount source file into container
# if you copy over the source code, editing on them will not
# reflect outside of the container and can lose your file change

# install command
ENV TERM=${TERM}
ENV COLORTERM=${COLORTERM}

RUN apt update \
  && apt install -y git zsh nano vim fontconfig \
  && git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ~/powerlevel10k \
  && echo "source ~/powerlevel10k/powerlevel10k.zsh-theme" >>~/.zshrc \
  && cd ~/powerlevel10k \
  && exec zsh

RUN ls -la && mkdir -p ~/.font
COPY .devcontainer/.fonts/. ~/.fonts/
RUN cd ~/.font \
  && fc-cache -f -v