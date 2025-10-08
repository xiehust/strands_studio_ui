# syntax=docker/dockerfile:1.7
# Dockerfile for Strands Agent ECS Fargate Deployment
FROM --platform=$TARGETPLATFORM public.ecr.aws/docker/library/python:3.11-slim

# Set environment variables for faster builds
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=0

# Set working directory
WORKDIR /app

# Install minimal system dependencies with cache mount
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Install Python dependencies with cache mount and prefer binary packages
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -U pip && \
    python -m pip install --prefer-binary --no-compile -r requirements.txt

# Copy application files
COPY generated_agent.py .
COPY agent_server.py .

# Create health check endpoint script
RUN echo '#!/bin/sh\ncurl -fsS http://localhost:8000/health || exit 1' > /health_check.sh && \
    chmod +x /health_check.sh

# Expose the application port
EXPOSE 8000

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD /health_check.sh

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Run the application
CMD ["python", "agent_server.py"]