# Learner entry node ("learner@workstation"): ssh client + kubectl, nothing else.
# Built by tools/images/build-jumphost.sh, version args come from deploy/versions.env.
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ARG KUBECTL_VERSION
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssh-client bash-completion vim-tiny less curl ca-certificates \
      iproute2 iputils-ping dnsutils jq \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSLo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
 && echo "$(curl -fsSL https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl.sha256)  /usr/local/bin/kubectl" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/kubectl \
 && mkdir -p /etc/bash_completion.d && kubectl completion bash > /etc/bash_completion.d/kubectl
RUN userdel -r ubuntu 2>/dev/null; useradd -m -u 1000 -s /bin/bash learner \
 && printf 'source /etc/bash_completion\nalias k=kubectl\ncomplete -o default -F __start_kubectl k\n' >> /home/learner/.bashrc
USER learner
WORKDIR /home/learner
CMD ["sleep", "infinity"]
