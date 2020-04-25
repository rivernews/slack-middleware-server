# watching a semaphore value
# watch -d -n 3 KUBECONFIG=kubeconfig.yaml kubectl -n redis-cluster exec deploy/redis-cluster-deployment -- bash -c "redis-cli <<<$'select 6\nzrange k8JobResourceLock 0 -1'"

# watch -d -n 3 KUBECONFIG=kubeconfig.yaml kubectl -n redis-cluster exec deploy/redis-cluster-deployment -- bash -c "redis-cli <<<$'select 6\nzrange travisJobResourceLock 0 -1'"

while :; 
  do 
  clear
  date
  KUBECONFIG=kubeconfig.yaml kubectl -n redis-cluster exec deploy/redis-cluster-deployment -- bash -c "redis-cli -a \$(printenv REDIS_PASSWORD) <<<$'select 5\n keys sema*travis* \n zrange semaphore:travisJobResourceLock 0 -1 \n keys sema*k8* \n zrange semaphore:k8JobResourceLock 0 -1'"
  sleep 3
done


