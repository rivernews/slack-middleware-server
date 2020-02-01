IMAGE_NAME=shaungc/slack-middleware-service
VERSION=0.0.2

docker build -f prod.Dockerfile -t ${IMAGE_NAME}:latest .

docker tag ${IMAGE_NAME}:latest ${IMAGE_NAME}:${VERSION}
docker push ${IMAGE_NAME}:latest
docker push ${IMAGE_NAME}:${VERSION}