// Production starter - Run only secure-cloud-backend for Render deployment
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Ecosprinkle Secure Backend Service...');
console.log('📍 Working Directory:', __dirname);
console.log('🌐 Environment:', process.env.NODE_ENV || 'development');

// For production on Render, only run the secure backend to avoid port conflicts
const serverFile = 'secure-cloud-backend.js';

// Start the secure backend server
const server = spawn('node', [path.join(__dirname, serverFile)], {
    stdio: 'inherit',
    cwd: __dirname,
    env: {
        ...process.env,
        // Ensure the secure server uses Render's PORT
        SECURE_CLOUD_PORT: process.env.PORT || 3001
    }
});

// Handle process termination
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down server...');
    server.kill('SIGTERM');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down server...');
    server.kill('SIGINT');
    process.exit(0);
});

// Handle server exit
server.on('exit', (code) => {
    console.log(`❌ Server exited with code ${code}`);
    process.exit(code || 1);
});

console.log('✅ Secure backend server started successfully');
