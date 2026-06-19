FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy application configuration
COPY package.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy source code
COPY server.js ./

# Download Argo Rollouts CLI dynamically to keep git repository size small
RUN apk add --no-cache curl \
    && curl -LO https://github.com/argoproj/argo-rollouts/releases/latest/download/kubectl-argo-rollouts-linux-amd64 \
    && mv kubectl-argo-rollouts-linux-amd64 /app/kubectl-argo-rollouts \
    && chmod +x /app/kubectl-argo-rollouts \
    && apk del curl

# Set environment defaults
ENV PORT=5000
EXPOSE 5000

# Start server
CMD ["node", "server.js"]
