# Use multi-arch ECR image for Lambda Web Adapter (no manual arch handling needed)
FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 as adapter
FROM python:3.12-slim

# Copy Lambda Web Adapter from ECR multi-arch image
COPY --from=adapter /lambda-adapter /opt/extensions/lambda-adapter
RUN chmod +x /opt/extensions/lambda-adapter

# Set working directory
WORKDIR /var/task

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .
COPY generated_agent.py .

# Set environment variables for Lambda Web Adapter
ENV AWS_LWA_PORT=8080
ENV AWS_LWA_INVOKE_MODE=response_stream

# LWA runs as extension, not ENTRYPOINT - Lambda will auto-inject it
# Start FastAPI with uvicorn
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]