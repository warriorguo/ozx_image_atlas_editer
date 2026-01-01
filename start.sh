#!/bin/bash

# Atlas Image Editor Startup Script

echo "Starting Atlas Image Editor..."

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for Python
if ! command_exists python3; then
    echo "Error: Python 3 is required but not installed."
    exit 1
fi

# Check for Node.js
if ! command_exists node; then
    echo "Error: Node.js is required but not installed."
    exit 1
fi

# Start backend
echo "Starting backend server..."
cd backend
python3 -m pip install -r requirements.txt > /dev/null 2>&1
python3 app.py &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 3

# Start frontend
echo "Starting frontend server..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install > /dev/null 2>&1
fi
npm start &
FRONTEND_PID=$!
cd ..

echo "Atlas Image Editor is starting up..."
echo "Backend: http://localhost:5001"
echo "Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both servers"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down servers..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

# Trap Ctrl+C
trap cleanup INT

# Wait for user to stop
wait