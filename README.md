# Ecosprinkle Backend API

A comprehensive Node.js backend API for the Ecosprinkle IoT system, providing MongoDB integration to replace Firebase Firestore collections.

## Features

- **User Authentication**: JWT-based authentication with password hashing
- **Device Management**: Register, monitor, and control IoT devices
- **Real-time Sensor Data**: Store and stream moisture, temperature, and battery data
- **Device Commands**: Send commands to devices (watering, thresholds, schedules)
- **Notifications**: Device status and alert notifications
- **WebSocket Support**: Real-time updates via Socket.IO
- **MongoDB Integration**: Complete replacement for Firebase Firestore

## Firebase Collections Migrated

| Firebase Collection | MongoDB Collection | Purpose |
|-------------------|-------------------|---------|
| `devices` | `devices` | Device registration and metadata |
| `sensor_data` | `sensordatas` | Real-time sensor readings |
| `device_commands` | `devicecommands` | Commands sent to devices |
| `notifications` | `notifications` | Device notifications |

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Setup:**
   Create a `.env` file with:
   ```
   MONGODB_URI=mongodb://localhost:27017/Ecosprinkle
   PORT=3000
   NODE_ENV=development
   JWT_SECRET=your_secure_jwt_secret_key
   ```

3. **Start MongoDB:**
   Make sure MongoDB is running on your system.

4. **Start the server:**
   ```bash
   npm start
   # or for development
   npm run dev
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login

### Device Management
- `POST /api/devices/register` - Register new device
- `GET /api/devices/check/:deviceId` - Check if device is registered
- `GET /api/devices/:deviceId` - Get device by ID
- `PUT /api/devices/:deviceId/status` - Update device status
- `PUT /api/devices/:deviceId/plant` - Associate device with plant
- `GET /api/users/:userId/devices` - Get user's devices

### Sensor Data
- `POST /api/sensor/:deviceId/data` - Store sensor data
- `GET /api/sensor/:deviceId/stream` - Get real-time sensor data
- `GET /api/sensor/:deviceId/history` - Get sensor data history

### Device Commands
- `POST /api/commands/:deviceId` - Send command to device
- `GET /api/commands/:deviceId/pending` - Get pending commands
- `PUT /api/commands/:commandId/executed` - Mark command as executed
- `PUT /api/commands/:commandId/failed` - Mark command as failed

### Watering Controls
- `POST /api/watering/:deviceId/command` - Send watering command
- `PUT /api/watering/:deviceId/thresholds` - Update moisture thresholds
- `PUT /api/watering/:deviceId/mode` - Set watering mode
- `PUT /api/watering/:deviceId/schedules` - Set watering schedules

### Device Status
- `GET /api/status/:deviceId` - Get device status
- `GET /api/status/:deviceId/online` - Check if device is online

### Notifications
- `GET /api/notifications/:deviceId` - Get device notifications
- `POST /api/notifications` - Create notification
- `PUT /api/notifications/:notificationId/read` - Mark notification as read

## Data Models

### User
```javascript
{
  email: String (required, unique),
  name: String (required),
  password: String (required, hashed),
  devices: [ObjectId],
  createdAt: Date,
  lastLogin: Date
}
```

### Device
```javascript
{
  userID: String,
  QRcode: String,
  deviceId: String (required, unique),
  deviceType: String,
  MACaddress: String,
  securityKey: String,
  WifiSSID: String,
  DeviceName: String,
  isActive: Boolean,
  LastUpdated: Date,
  plantID: String,
  Status: String,
  moistureLevel: Number,
  batteryLevel: Number,
  location: Object,
  schedule: Array,
  wateringMode: String,
  thresholds: Object,
  isWateringEnabled: Boolean,
  lastSensorUpdate: Date
}
```

### SensorData
```javascript
{
  deviceId: String,
  timestamp: Date,
  moistureLevel: Number,
  moisturePercent: Number,
  soilStatus: String,
  isWatering: Boolean,
  wateringMode: String,
  deviceStatus: String,
  batteryLevel: Number,
  temperature: Number,
  pumpStatus: String
}
```

### DeviceCommand
```javascript
{
  deviceId: String,
  command: String,
  plantId: String,
  parameters: Map,
  timestamp: Date,
  status: String,
  executed: Boolean,
  processed: Boolean,
  response: Mixed,
  error: String,
  executedAt: Date,
  processedAt: Date,
  failedAt: Date
}
```

### Notification
```javascript
{
  deviceId: String,
  userId: String,
  type: String,
  title: String,
  message: String,
  severity: String,
  timestamp: Date,
  read: Boolean,
  readAt: Date,
  data: Map
}
```

## WebSocket Events

### Client Events
- `subscribe` - Subscribe to device updates
- `unsubscribe` - Unsubscribe from device updates

### Server Events
- `sensor-update:{deviceId}` - Real-time sensor data updates
- `device-command:{deviceId}` - New device commands
- `notification:{userId}` - New notifications

## Usage Examples

### Register Device
```javascript
POST /api/devices/register
Authorization: Bearer <token>
Content-Type: application/json

{
  "deviceData": {
    "deviceId": "ESP001",
    "deviceName": "Garden Sensor",
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "securityKey": "secret123",
    "wifiSSID": "MyWiFi"
  },
  "userId": "user_id_here"
}
```

### Store Sensor Data
```javascript
POST /api/sensor/ESP001/data
Content-Type: application/json

{
  "moistureLevel": 1800,
  "moisturePercent": 45.2,
  "soilStatus": "Moist",
  "isWatering": false,
  "wateringMode": "automatic",
  "deviceStatus": "Online",
  "batteryLevel": 85,
  "temperature": 22.5,
  "pumpStatus": "OFF"
}
```

### Send Watering Command
```javascript
POST /api/commands/ESP001
Authorization: Bearer <token>
Content-Type: application/json

{
  "command": "PUMP_ON",
  "parameters": {
    "duration": 30
  }
}
```

## Migration from Firebase

This backend provides a complete replacement for Firebase Firestore operations:

1. **Authentication**: JWT-based auth replaces Firebase Auth
2. **Database**: MongoDB replaces Firestore collections
3. **Real-time**: Socket.IO replaces Firestore real-time listeners
4. **Storage**: All data operations converted to REST APIs

## Development

- **Testing**: Use `test-db.js` to test database connections
- **Linting**: Follow standard Node.js practices
- **Error Handling**: Comprehensive error handling with proper HTTP status codes
- **Security**: JWT authentication, password hashing, input validation

## License

ISC