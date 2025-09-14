#!/bin/bash

# Start All Services - Production Mode
# This script starts both frontend and backend services in production mode

set -e  # Exit on any error

echo "🚀 Starting Open Studio for Strands Agent UI in Production Mode..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js first.${NC}"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed. Please install npm first.${NC}"
    exit 1
fi

# Check if uv is installed for backend
if ! command -v uv &> /dev/null; then
    echo -e "${RED}❌ uv is not installed. Please install uv first (backend dependency manager).${NC}"
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Detect if we're running on a cloud instance (has public IP different from localhost)
detect_public_ip() {
    # Try to get public IP from AWS metadata service (works for EC2)
    local public_ip=""
    if command -v curl &> /dev/null; then
        public_ip=$(curl -s --connect-timeout 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "")
    fi

    # If AWS metadata doesn't work, try other methods
    if [ -z "$public_ip" ]; then
        # Try to get external IP via external service
        public_ip=$(curl -s --connect-timeout 3 https://api.ipify.org 2>/dev/null || echo "")
    fi

    echo "$public_ip"
}

# Set up environment variables for API URL
setup_api_url() {
    local public_ip=$(detect_public_ip)

    # Check if ALB_HOSTNAME environment variable is set (for ALB deployments)
    if [ -n "$ALB_HOSTNAME" ]; then
        echo -e "${BLUE}🌐 ALB deployment detected: $ALB_HOSTNAME${NC}"
        echo -e "${BLUE}📡 Configuring API URL for ALB deployment...${NC}"

        # Create .env.local for ALB deployment
        cat > .env.local << EOF
# Auto-generated for ALB deployment
VITE_API_BASE_URL=http://$ALB_HOSTNAME:8000
EOF
        echo -e "${GREEN}✅ Created .env.local with API URL: http://$ALB_HOSTNAME:8000${NC}"
        echo -e "${YELLOW}💡 Frontend will connect to backend at: http://$ALB_HOSTNAME:8000${NC}"
        echo -e "${YELLOW}💡 Access your application at: http://$ALB_HOSTNAME:5173${NC}"

    elif [ -n "$public_ip" ] && [ "$public_ip" != "127.0.0.1" ] && [ "$public_ip" != "localhost" ]; then
        echo -e "${BLUE}🌐 Detected public IP: $public_ip${NC}"
        echo -e "${BLUE}📡 Configuring API URL for cloud deployment...${NC}"

        # Create .env.local for production build
        cat > .env.local << EOF
# Auto-generated for cloud deployment
VITE_API_BASE_URL=http://$public_ip:8000
EOF
        echo -e "${GREEN}✅ Created .env.local with API URL: http://$public_ip:8000${NC}"
        echo -e "${YELLOW}💡 Frontend will connect to backend at: http://$public_ip:8000${NC}"
        echo -e "${YELLOW}💡 Access your application at: http://$public_ip:5173${NC}"
    else
        echo -e "${BLUE}🏠 Local deployment detected, using localhost configuration${NC}"
        # Remove .env.local if it exists to use default localhost behavior
        rm -f .env.local
        echo -e "${YELLOW}💡 Frontend will use dynamic API URL detection${NC}"
        echo -e "${YELLOW}💡 For ALB deployment, set ALB_HOSTNAME environment variable${NC}"
    fi
}

# Function to check if port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Check if ports are available
FRONTEND_PORT=5173
BACKEND_PORT=8000

if check_port $FRONTEND_PORT; then
    echo -e "${YELLOW}⚠️  Port $FRONTEND_PORT is already in use. Continuing anyway...${NC}"
fi

if check_port $BACKEND_PORT; then
    echo -e "${YELLOW}⚠️  Port $BACKEND_PORT is already in use. Continuing anyway...${NC}"
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}📦 Installing frontend dependencies...${NC}"
    npm install
fi

# Set up API URL configuration for cloud deployment
setup_api_url

# Build frontend for production
echo -e "${BLUE}🏗️  Building frontend for production...${NC}"
npm run build

# Start backend in production mode (background)
echo -e "${BLUE}🔧 Starting backend server...${NC}"
cd backend
nohup uv run uvicorn main:app --host 0.0.0.0 --port 8000 > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > ../logs/backend.pid
cd ..

# Wait a moment for backend to start
sleep 3

# Check if backend started successfully
if kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${GREEN}✅ Backend server started successfully (PID: $BACKEND_PID)${NC}"
else
    echo -e "${RED}❌ Backend server failed to start${NC}"
    exit 1
fi

# Start frontend preview server (background)
echo -e "${BLUE}🌐 Starting frontend preview server...${NC}"
nohup npm run preview -- --host 0.0.0.0 --port 5173 > logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > logs/frontend.pid

# Wait a moment for frontend to start
sleep 3

# Check if frontend started successfully
if kill -0 $FRONTEND_PID 2>/dev/null; then
    echo -e "${GREEN}✅ Frontend server started successfully (PID: $FRONTEND_PID)${NC}"
else
    echo -e "${RED}❌ Frontend server failed to start${NC}"
    # Kill backend if frontend failed
    kill $BACKEND_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 All services started successfully!${NC}"
echo ""
echo -e "${BLUE}📍 Application URLs:${NC}"
echo -e "   Frontend: ${GREEN}http://localhost:5173${NC}"
echo -e "   Backend:  ${GREEN}http://localhost:8000${NC}"
echo -e "   API Docs: ${GREEN}http://localhost:8000/docs${NC}"
echo ""
echo -e "${BLUE}📝 Logs:${NC}"
echo -e "   Frontend: ${YELLOW}logs/frontend.log${NC}"
echo -e "   Backend:  ${YELLOW}logs/backend.log${NC}"
echo ""
echo -e "${BLUE}🛑 To stop all services:${NC}"
echo -e "   Run: ${YELLOW}./stop_all.sh${NC}"
echo ""
echo -e "${GREEN}✨ Strands UI is now running in production mode!${NC}"