# 📊 Database Schema Architecture Guide

## Overview

The EcoSprinkler backend uses **3 different schemas** for storing device and sensor information. Each serves a specific purpose to optimize performance and data organization.

---

## 🗄️ Schema Breakdown

### 1. **Device.js** - Master Device Registry
**Collection**: `devices`  
**Purpose**: Master registry of all registered devices with configuration and latest status

#### When to Use:
- ✅ Registering a new ESP32 device
- ✅ Storing device configuration (WiFi, thresholds, plant type)
- ✅ Showing "My Devices" list in frontend
- ✅ Updating device settings
- ✅ Checking if device is online/offline

#### What It Stores:
```javascript
{
  deviceId: "esp32-3c8a1f7f442c",
  userID: "user123",
  deviceName: "Garden Zone A",
  MACaddress: "3C:8A:1F:7F:44:2C",
  Status: "Online",
  plantType: "Tomato",
  soilType: "Loam",
  thresholds: { dryThreshold: 2000, wetThreshold: 1200 },
  
  // Latest sensor readings (CURRENT STATE only)
  sensorData: {
    zone1: 2099,
    zone1Percent: 0,
    zone2: 2394,
    zone2Percent: 0,
    zone3: 1909,
    zone3Percent: 12,
    majorityVoteDry: true,
    pumpState: 0,
    rssi: -33,
    receivedAt: "2025-10-19T10:30:00Z"
  }
}
```

#### Database Operations:
```javascript
// UPDATE on every MQTT message (upsert latest readings)
await Device.findOneAndUpdate(
  { deviceId: 'esp32-3c8a1f7f442c' },
  { 'sensorData.zone1': data.zone1, ... },
  { upsert: true }
);

// QUERY for device list
const devices = await Device.find({ userID: req.user.id });
```

---

### 2. **Sensor.js** - Live Sensor State (DEPRECATED - Consider Removing)
**Collection**: `sensors`  
**Purpose**: Originally intended for current sensor state, but **redundant** with Device.js

#### Current Status: ⚠️ **REDUNDANT**
This schema duplicates the functionality of `Device.sensorData`. Consider:
- **Option A**: Remove this schema entirely and use `Device.sensorData` only
- **Option B**: Repurpose it for sensor calibration settings
- **Option C**: Keep for backward compatibility but don't update it

#### Recommendation:
**Use Device.js instead** - The `sensorData` embedded document in Device.js provides the same "current state" functionality.

---

### 3. **SensorData.js** - Historical Time-Series Data
**Collection**: `sensordatas`  
**Purpose**: Store **EVERY sensor reading** for historical analysis and charts

#### When to Use:
- ✅ Creating charts (7-day moisture trends)
- ✅ Analyzing watering patterns
- ✅ Calculating average moisture levels
- ✅ Generating reports
- ✅ Machine learning / predictions

#### What It Stores:
```javascript
{
  deviceId: "esp32-3c8a1f7f442c",
  timestamp: "2025-10-19T10:30:15Z",      // Server time
  deviceTimestamp: 45230,                 // ESP32 uptime (ms)
  
  // All 3 zones
  zone1: 2099,
  zone1Percent: 0,
  zone2: 2394,
  zone2Percent: 0,
  zone3: 1909,
  zone3Percent: 12,
  
  // Voting results
  dryVotes: 3,
  wetVotes: 0,
  majorityVoteDry: true,
  validSensors: 3,
  sensorHealth: "normal",
  median: 1740,
  
  // Status
  pumpState: 0,
  rssi: -33
}
```

#### Database Operations:
```javascript
// INSERT on every MQTT message (append-only, never update)
await SensorData.create({
  deviceId: data.deviceId,
  timestamp: new Date(),
  deviceTimestamp: data.timestamp,
  zone1: data.zone1,
  zone1Percent: data.zone1Percent,
  // ... all other fields
});

// QUERY for time-series data
const readings = await SensorData.find({
  deviceId: 'esp32-3c8a1f7f442c',
  timestamp: { $gte: sevenDaysAgo }
}).sort({ timestamp: -1 });
```

---

## 🔄 Complete Data Flow

### When ESP32 Publishes Sensor Data:

```
1. ESP32 → MQTT → Backend receives message

2. Backend processes message:
   ├─ Parse JSON payload
   ├─ Apply ESP32 sensor algorithm
   └─ Validate data

3. Save to TWO collections:
   
   A. UPDATE Device (latest state only):
      Device.findOneAndUpdate(
        { deviceId: 'esp32-3c8a1f7f442c' },
        { 
          'sensorData.zone1': 2099,
          'sensorData.majorityVoteDry': true,
          'Status': 'Online',
          'LastUpdated': new Date()
        }
      )
   
   B. INSERT SensorData (append to history):
      SensorData.create({
        deviceId: 'esp32-3c8a1f7f442c',
        timestamp: new Date(),
        zone1: 2099,
        zone1Percent: 0,
        majorityVoteDry: true,
        // ... complete reading
      })
```

---

## 📱 Frontend Usage Examples

### Show Device List (Dashboard)
```javascript
// Use Device.js only
GET /api/devices
→ Returns all devices with latest sensor readings
```

### Show Current Status (Device Detail Page)
```javascript
// Use Device.js only
GET /api/devices/esp32-3c8a1f7f442c
→ Returns device config + latest sensorData
```

### Show 7-Day Moisture Chart
```javascript
// Use SensorData.js only
GET /api/sensor-data/esp32-3c8a1f7f442c/history?days=7
→ Returns array of all readings from last 7 days
```

### Show Real-Time Updates
```javascript
// WebSocket or Polling Device.js
ws://backend/devices/esp32-3c8a1f7f442c/live
→ Streams updates to Device.sensorData
```

---

## ⚡ Performance Optimization

### Indexes (Already Configured):

**Device.js:**
```javascript
deviceSchema.index({ userID: 1, deviceId: 1 });
deviceSchema.index({ LastUpdated: -1 });
```

**SensorData.js:**
```javascript
sensorDataSchema.index({ deviceId: 1, timestamp: -1 }); // Time-series queries
sensorDataSchema.index({ timestamp: -1 });              // Recent data
```

### Optional: Auto-Delete Old Data (TTL Index)
Uncomment in SensorData.js to automatically delete data older than 90 days:
```javascript
sensorDataSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });
```

---

## 🎯 Summary Table

| Schema | Purpose | Update Frequency | Query Pattern | Data Size |
|--------|---------|------------------|---------------|-----------|
| **Device.js** | Master registry + latest state | Update every message | `findOne({ deviceId })` | ~1 doc per device |
| **Sensor.js** | ⚠️ DEPRECATED | N/A | N/A | Consider removing |
| **SensorData.js** | Historical time-series | Insert every message | `find({ timestamp: $gte })` | ~8,640 docs/day (10s interval) |

---

## 🔧 Backend Implementation

### Correct MQTT Handler Pattern:

```javascript
mqttClient.on('message', async (topic, message) => {
  const data = JSON.parse(message.toString());
  
  // 1. Update Device (latest state)
  await Device.findOneAndUpdate(
    { deviceId: data.deviceId },
    {
      'sensorData.zone1': data.zone1,
      'sensorData.zone1Percent': data.zone1Percent,
      'sensorData.zone2': data.zone2,
      'sensorData.zone2Percent': data.zone2Percent,
      'sensorData.zone3': data.zone3,
      'sensorData.zone3Percent': data.zone3Percent,
      'sensorData.dryVotes': data.dryVotes,
      'sensorData.wetVotes': data.wetVotes,
      'sensorData.majorityVoteDry': data.majorityVoteDry,
      'sensorData.validSensors': data.validSensors,
      'sensorData.sensorHealth': data.sensorHealth,
      'sensorData.median': data.median,
      'sensorData.pumpState': data.pumpState,
      'sensorData.rssi': data.rssi,
      'sensorData.deviceTimestamp': data.timestamp,
      'sensorData.receivedAt': new Date(),
      'Status': 'Online',
      'LastUpdated': new Date()
    },
    { upsert: true, new: true }
  );
  
  // 2. Insert SensorData (historical record)
  await SensorData.create({
    deviceId: data.deviceId,
    timestamp: new Date(),
    deviceTimestamp: data.timestamp,
    zone1: data.zone1,
    zone1Percent: data.zone1Percent,
    zone2: data.zone2,
    zone2Percent: data.zone2Percent,
    zone3: data.zone3,
    zone3Percent: data.zone3Percent,
    dryVotes: data.dryVotes,
    wetVotes: data.wetVotes,
    majorityVoteDry: data.majorityVoteDry,
    validSensors: data.validSensors,
    sensorHealth: data.sensorHealth,
    median: data.median,
    pumpState: data.pumpState,
    rssi: data.rssi
  });
  
  console.log(`✅ Saved to both Device and SensorData collections`);
});
```

---

## ✅ Verification Checklist

After updating schemas, verify:

- [ ] Device.js has `sensorData` embedded document
- [ ] SensorData.js matches ESP32 MQTT payload exactly
- [ ] Backend updates Device (latest) on MQTT message
- [ ] Backend inserts SensorData (history) on MQTT message
- [ ] Frontend fetches Device for current status
- [ ] Frontend fetches SensorData for charts/history
- [ ] MongoDB indexes are created
- [ ] No duplicate data between collections

---

**Last Updated**: October 19, 2025  
**Schema Version**: 2.0 (Multi-zone support)
