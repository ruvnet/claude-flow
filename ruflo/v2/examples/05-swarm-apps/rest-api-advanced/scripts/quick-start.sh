#!/bin/bash

# Quick start script for the Advanced REST API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Advanced REST API - Quick Start${NC}"
echo "=================================="

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Function to wait for a service to be ready
wait_for_service() {
    local host=$1
    local port=$2
    local service=$3
    local max_attempts=30
    local attempt=1

    echo -n "Waiting for $service to be ready..."
    
    while ! nc -z "$host" "$port" 2>/dev/null; do
        if [ $attempt -eq $max_attempts ]; then
            echo -e " ${RED}Failed!${NC}"
            echo -e "${RED}❌ $service failed to start after $max_attempts attempts${NC}"
            return 1
        fi
        echo -n "."
        sleep 1
        ((attempt++))
    done
    
    echo -e " ${GREEN}Ready!${NC}"
    return 0
}

# Check prerequisites
echo -e "${BLUE}📋 Checking prerequisites...${NC}"

if ! command_exists docker; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command_exists docker-compose; then
    echo -e "${RED}❌ Docker Compose is not installed. Please install Docker Compose first.${NC}"
    echo "Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

if ! command_exists node; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js >= 16.0.0${NC}"
    echo "Visit: https://nodejs.org/"
    exit 1
fi

if ! command_exists npm; then
    echo -e "${RED}❌ npm is not installed. Please install npm.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All prerequisites met!${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}📝 Creating .env file from .env.example...${NC}"
    cp .env.example .env
    
    # Generate a secure JWT secret
    JWT_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
    
    # Update .env with generated secret
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    else
        # Linux
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    fi
    
    echo -e "${GREEN}✅ Generated secure JWT secret${NC}"
fi

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install

# Start services with Docker Compose
echo -e "${BLUE}🐳 Starting Docker services...${NC}"
docker-compose up -d

# Wait for services to be ready
echo -e "${BLUE}⏳ Waiting for services to start...${NC}"
wait_for_service localhost 27017 "MongoDB"
wait_for_service localhost 6379 "Redis"

# Run database seeder
echo -e "${BLUE}🌱 Seeding database...${NC}"
npm run seed

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down...${NC}"
    docker-compose down
    exit 0
}

# Set up cleanup trap
trap cleanup INT TERM

# Start the application
echo -e "${BLUE}🎯 Starting the application...${NC}"
echo ""
echo -e "${GREEN}✅ Advanced REST API is starting!${NC}"
echo ""
echo -e "${BLUE}📍 API Server:${NC} http://localhost:3000"
echo -e "${BLUE}📚 API Documentation:${NC} http://localhost:3000/api-docs"
echo -e "${BLUE}🔍 Health Check:${NC} http://localhost:3000/api/health"
echo ""
echo -e "${YELLOW}Default Accounts:${NC}"
echo "  Admin: admin@example.com / password123"
echo "  User: user@example.com / password123"
echo ""
echo -e "${YELLOW}Available Scripts:${NC}"
echo "  npm run dev     - Start development server"
echo "  npm test        - Run tests"
echo "  npm run lint    - Run linter"
echo "  npm run seed    - Reseed database"
echo ""
echo -e "${YELLOW}Docker Services:${NC}"
echo "  MongoDB: localhost:27017"
echo "  Redis: localhost:6379"
echo ""
echo -e "${RED}Press Ctrl+C to stop all services${NC}"
echo ""

# Start the development server
npm run dev