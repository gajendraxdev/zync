ARG MYSQL_IMAGE=mysql:8.4
FROM ${MYSQL_IMAGE}

# Qualification only: run the published Oracle client and SSH server in one
# private namespace. No image, account or configuration is used by the app.
USER root
RUN microdnf install -y openssh-server shadow-utils \
    && microdnf clean all \
    && useradd --create-home --uid 1101 observer \
    && mkdir -p /run/sshd /docker-entrypoint-initdb.d
COPY entrypoint.sh /usr/local/bin/zync-runtime-fixture
RUN chmod 0755 /usr/local/bin/zync-runtime-fixture
ENTRYPOINT ["/usr/local/bin/zync-runtime-fixture"]
