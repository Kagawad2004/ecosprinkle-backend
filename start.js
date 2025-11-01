// Simple dual-server starter for production
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Ecosprinkle Backend Services...');
console.log('📍 Working Directory:', __dirname);

// Start secure-cloud-backend.js
const secureServer = spawn('node', [path.join(__dirname, 'secure-cloud-backend.js')], {
    stdio: 'inherit',
    cwd: __dirname
});

// Start index.js
const mainServer = spawn('node', [path.join(__dirname, 'index.js')], {
    stdio: 'inherit',
    cwd: __dirname
});

// Handle process termination
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down servers...');
    secureServer.kill('SIGTERM');
    mainServer.kill('SIGTERM');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down servers...');
    secureServer.kill('SIGINT');
    mainServer.kill('SIGINT');
    process.exit(0);
});

// Handle server exits
secureServer.on('exit', (code) => {
    console.log(`❌ Secure server exited with code ${code}`);
    process.exit(code || 1);
});

mainServer.on('exit', (code) => {
    console.log(`❌ Main server exited with code ${code}`);
    process.exit(code || 1);
});

console.log('✅ Both servers started successfully');
