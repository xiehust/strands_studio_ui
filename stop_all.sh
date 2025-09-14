#!/bin/bash

# Stop All Services
# This script stops both frontend and backend services

set -e  # Exit on any error

echo "🛑 Stopping Strands UI Services..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to stop service by PID file
stop_service() {
    local service_name=$1
    local pid_file=$2

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            echo -e "${BLUE}🔄 Stopping $service_name (PID: $pid)...${NC}"
            kill "$pid"

            # Wait for graceful shutdown
            local count=0
            while kill -0 "$pid" 2>/dev/null && [ $count -lt 10 ]; do
                sleep 1
                count=$((count + 1))
            done

            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                echo -e "${YELLOW}⚠️  Force killing $service_name...${NC}"
                kill -9 "$pid" 2>/dev/null || true
            fi

            echo -e "${GREEN}✅ $service_name stopped successfully${NC}"
        else
            echo -e "${YELLOW}⚠️  $service_name was not running (stale PID file)${NC}"
        fi
        rm -f "$pid_file"
    else
        echo -e "${YELLOW}⚠️  No PID file found for $service_name${NC}"
    fi
}

# Function to stop services by port
stop_by_port() {
    local service_name=$1
    local port=$2

    local pids=$(lsof -t -i:$port 2>/dev/null || echo "")
    if [ -n "$pids" ]; then
        echo -e "${BLUE}🔄 Stopping $service_name processes on port $port...${NC}"
        for pid in $pids; do
            if kill -0 "$pid" 2>/dev/null; then
                echo -e "${BLUE}   Stopping process $pid...${NC}"
                kill "$pid" 2>/dev/null || true

                # Wait for graceful shutdown
                local count=0
                while kill -0 "$pid" 2>/dev/null && [ $count -lt 5 ]; do
                    sleep 1
                    count=$((count + 1))
                done

                # Force kill if still running
                if kill -0 "$pid" 2>/dev/null; then
                    kill -9 "$pid" 2>/dev/null || true
                fi
            fi
        done
        echo -e "${GREEN}✅ $service_name processes stopped${NC}"
    else
        echo -e "${YELLOW}⚠️  No $service_name processes found on port $port${NC}"
    fi
}

# Stop services using PID files first
if [ -d "logs" ]; then
    stop_service "Backend" "logs/backend.pid"
    stop_service "Frontend" "logs/frontend.pid"
else
    echo -e "${YELLOW}⚠️  No logs directory found${NC}"
fi

# Stop any remaining processes on the ports as backup
echo -e "${BLUE}🔍 Checking for any remaining processes...${NC}"
stop_by_port "Frontend" "5173"
stop_by_port "Backend" "8000"

# Also check for development servers that might be running
stop_by_port "Dev Backend" "8001"

# Clean up any remaining Strands UI related processes
echo -e "${BLUE}🧹 Cleaning up any remaining Strands UI processes...${NC}"

# Stop any remaining uvicorn processes
uvicorn_pids=$(pgrep -f "uvicorn.*main:app" 2>/dev/null || echo "")
if [ -n "$uvicorn_pids" ]; then
    echo -e "${BLUE}🔄 Stopping uvicorn processes...${NC}"
    for pid in $uvicorn_pids; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            sleep 1
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
    done
    echo -e "${GREEN}✅ Uvicorn processes stopped${NC}"
fi

# Stop any remaining Vite processes
vite_pids=$(pgrep -f "vite.*preview" 2>/dev/null || echo "")
if [ -n "$vite_pids" ]; then
    echo -e "${BLUE}🔄 Stopping Vite processes...${NC}"
    for pid in $vite_pids; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            sleep 1
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
    done
    echo -e "${GREEN}✅ Vite processes stopped${NC}"
fi

echo ""
echo -e "${GREEN}🎉 All Strands UI services have been stopped!${NC}"
echo ""
echo -e "${BLUE}📝 Log files are preserved in:${NC}"
echo -e "   Frontend: ${YELLOW}logs/frontend.log${NC}"
echo -e "   Backend:  ${YELLOW}logs/backend.log${NC}"
echo ""
echo -e "${BLUE}🚀 To start services again:${NC}"
echo -e "   Development: ${YELLOW}npm run dev:full${NC}"
echo -e "   Production:  ${YELLOW}./start_all.sh${NC}"