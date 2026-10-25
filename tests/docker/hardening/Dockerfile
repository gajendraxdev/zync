# Qualification-only image. The matrix records resolved base/image IDs in its output.
ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-server sudo coreutils procps ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -s /bin/sh ordinary \
    && useradd -m -s /bin/sh admin \
    && useradd -m -s /bin/sh denied \
    && mkdir -p /run/sshd \
    && printf 'Defaults timestamp_timeout=0\nadmin ALL=(root) ALL\n' > /etc/sudoers.d/zync-qualifier \
    && chmod 0440 /etc/sudoers.d/zync-qualifier \
    && printf 'UseDNS no\nPasswordAuthentication no\nPubkeyAuthentication yes\nPermitRootLogin prohibit-password\nStrictModes yes\nAllowTcpForwarding no\nX11Forwarding no\n' > /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/zync-qualification-entrypoint
RUN chmod 0755 /usr/local/bin/zync-qualification-entrypoint
ENTRYPOINT ["/usr/local/bin/zync-qualification-entrypoint"]
