FROM node:20-alpine

# Install dependencies
RUN apk add --no-cache \
    bash \
    git \
    curl \
    jq

# Use node user (already exists in node:20-alpine)
WORKDIR /home/node

# Copy test scripts
COPY --chown=node:node *.sh /home/node/

# Make scripts executable
RUN chmod +x /home/node/*.sh

CMD ["/bin/bash"]
