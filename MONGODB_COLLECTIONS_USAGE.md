# 📊 MongoDB Collections Usage Analysis

## 🗄️ **COLLECTIONS IN DATABASE (from screenshot)**

Based on your MongoDB database `test`, these collections exist:
1. ✅ `devicecommands`
2. ✅ `devices`
3. ✅ `logs`
4. ✅ `notifications`
5. ✅ `plants`
6. ✅ `sensordatas`
7. ✅ `sensors`
8. ✅ `users`

---

## ✅ **ACTIVELY USED COLLECTIONS**

### 1. **`devices`** (Model: Device)
**Status**: ✅ **HEAVILY USED** - Core functionality

**Where data is written:**
- `routes/devices.js`:
  - Line 168: `existingDevice.save()` - Update device settings
  - Line 257: `device.save()` - Create new device
- `routes/onboarding.js`:
  - Line 161: `device.save()` - Onboarding device registration
- `secure-cloud-backend.js`:
  - Line 267: Update `lastSeen` timestamp via MQTT

**Where data is read:**
- `routes/devices.js`: GET /devices, GET /devices/:deviceId, etc.
- `routes/sensors.js`: Fetch device settings
- `services/wateringDecisionEngine.js`: Get device mode, thresholds, plant type
- `controllers/wateringController.js`: Check device status before commands

**Purpose**: Store device metadata (deviceId, MAC, WiFi, settings, plant info, thresholds, mode)

---

### 2. **`sensordatas`** (Model: SensorData)
**Status**: ✅ **HEAVILY USED** - Core functionality

**Where data is written:**
- `secure-cloud-backend.js`:
  - Lines 213-235: `storeSensorDataSafely()` - Stores sensor readings from ESP32
  - Called every 10 seconds when ESP32 publishes data
- `services/wateringDecisionEngine.js`:
  - Line 279-297: `sensorEntry.save()` - Stores sensor data with watering decision
- `index.js` (old backend):
  - Line 434-467: Creates and saves sensor data
  - Line 520-534: Alternative storage path

**Where data is read:**
- `routes/sensors.js`:
  - Line 82-83: GET /sensors/device/:deviceId - Fetch historical sensor data
  - Line 203-204: GET /sensors/data/history - Time-series data
- `routes/devices.js`:
  - Line 622: Check latest sensor data before deletion
  - Line 687: Get latest sensor reading

**Purpose**: Time-series storage of sensor readings (zone1, zone2, zone3, moisture %, timestamp)

---

### 3. **`users`** (Model: User)
**Status**: ✅ **ACTIVELY USED** - Authentication & user management

**Where data is written:**
- `controllers/authController.js`:
  - Line 120-122: `user.save()` - Signup (create new user)
  - Line 252, 259: Update lastLogin on login
  - Line 316, 363, 429, 451, 588: Profile updates, password resets
  - Line 632-652: Google OAuth user creation/update

**Where data is read:**
- `controllers/authController.js`: Login, profile, password reset
- `routes/devices.js`: Link devices to users via userID
- `middleware/auth.js`: JWT authentication

**Purpose**: Store user accounts (username, password hash, email, profile, devices)

---

### 4. **`logs`** (Model: Log)
**Status**: ⚠️ **PARTIALLY USED** - Only in old backend (index.js)

**Where data is written:**
- `index.js` (OLD BACKEND):
  - Line 562-569: Creates sensor logs
  - Line 597: Creates irrigation logs
- ❌ **NOT USED** in `secure-cloud-backend.js` (current backend)

**Where data is read:**
- `routes/logs.js`:
  - Line 45: GET /logs - Fetch all logs
  - Line 112: GET /logs/sensor - Sensor-specific logs
  - Line 123: GET /logs/irrigation - Irrigation logs
  - Line 212: GET /logs/device/:deviceId - Device-specific logs

**Status**: 🔴 **COLLECTION EXISTS BUT NOT BEING POPULATED**
- Logs are read via API endpoints
- BUT new sensor data in `secure-cloud-backend.js` does NOT create log entries
- Only `sensordatas` collection is populated

**Fix needed**: If you want logs.dart to show historical data, you need to:
1. Create log entries in `secure-cloud-backend.js` when sensor data arrives
2. OR modify frontend to read from `sensordatas` instead of `logs`

---

### 5. **`devicecommands`** (Model: DeviceCommand)
**Status**: ⚠️ **DEFINED BUT NOT ACTIVELY USED**

**Where it's imported:**
- `controllers/wateringController.js`: Line 2
- `controllers/deviceController.js`: Line 4

**Where data should be written:**
- When backend sends PUMP_ON/PUMP_OFF commands to ESP32
- Currently commands are sent via MQTT but NOT stored in database

**Purpose**: Track command history (PUMP_ON, PUMP_OFF, duration, status, timestamp)

**Status**: 🟡 **MODEL EXISTS BUT NOT STORING DATA**
- Commands are sent via MQTT
- No database records created for audit trail
- Consider adding command logging for debugging

---

### 6. **`sensors`** (Model: Sensor)
**Status**: ⚠️ **MINIMAL USAGE**

**Where it's imported:**
- `routes/sensors.js`: Line 5
- `controllers/sensorController.js`: Line 1
- `secure-cloud-backend.js`: Line 370

**Where data might be written:**
- ❌ No direct usage found in codebase
- Model exists but not actively creating sensor records

**Purpose**: Store sensor metadata (calibration, type, zone configuration)
- Currently calibration data is stored in Device model
- Sensor model appears to be legacy/unused

**Status**: 🔴 **COLLECTION EXISTS BUT UNUSED**
- Consider removing if not needed
- OR migrate calibration data from Device model to Sensor model

---

### 7. **`plants`** (Model: Plant)
**Status**: ⚠️ **MINIMAL USAGE**

**Where it's imported:**
- `controllers/deviceController.js`: Line 2

**Where data might be written:**
- ❌ No direct usage found in codebase
- Model exists but not actively creating plant records

**Purpose**: Store plant library (name, description, ideal conditions, care instructions)
- Currently plant info (plantType, plantID) is stored in Device model
- Plant model appears to be for a future plant database feature

**Status**: 🟡 **COLLECTION EXISTS BUT NOT POPULATED**
- Frontend uses plantType strings ("Leafy Vegetables", "Others")
- No plant library implementation yet

---

### 8. **`notifications`** (Model: Notification)
**Status**: ⚠️ **MINIMAL USAGE**

**Where it's imported:**
- `controllers/deviceController.js`: Line 5

**Where data might be written:**
- ❌ No direct usage found in codebase
- Model exists but not actively creating notifications

**Purpose**: Store user notifications (low moisture alerts, pump failures, etc.)

**Status**: 🔴 **COLLECTION EXISTS BUT UNUSED**
- No notification system implemented
- Model ready for future push notification feature

---

## 📊 **SUMMARY TABLE**

| Collection | Model | Status | Write Frequency | Read Frequency | Purpose |
|------------|-------|--------|----------------|----------------|---------|
| **devices** | Device | ✅ Active | Medium (on registration/update) | High (every API call) | Device metadata |
| **sensordatas** | SensorData | ✅ Active | **HIGH (every 10s from ESP32)** | High (charts, logs, control) | Time-series sensor data |
| **users** | User | ✅ Active | Low (signup/login) | Medium (auth, profile) | User accounts |
| **logs** | Log | ⚠️ Partial | ❌ **NOT WRITING** | Medium (logs.dart) | Action history |
| **devicecommands** | DeviceCommand | 🟡 Defined | ❌ **NOT WRITING** | None | Command audit trail |
| **sensors** | Sensor | 🔴 Unused | None | None | Sensor metadata |
| **plants** | Plant | 🔴 Unused | None | None | Plant library |
| **notifications** | Notification | 🔴 Unused | None | None | User alerts |

---

## 🚨 **CRITICAL ISSUES FOUND**

### Issue 1: **Logs Collection Not Being Populated**
**Problem**: 
- Frontend `logs.dart` reads from `/api/logs/sensor` endpoint
- Endpoint queries `Log` collection
- BUT `secure-cloud-backend.js` NEVER creates log entries
- Only `index.js` (old backend) creates logs

**Impact**:
- logs.dart shows empty/stale data
- No sensor history in logs view
- Only works if using old `index.js` backend

**Solution Options**:

**Option A: Add Log Creation to secure-cloud-backend.js**
```javascript
// In secure-cloud-backend.js after storing sensor data (line ~240)
const Log = require('./models/Log');

await Log.logSensor(
    deviceId,
    {
        zone1: processedData.zone1.moisturePercent,
        zone2: processedData.zone2.moisturePercent,
        zone3: processedData.zone3.moisturePercent
    },
    {
        dryVotes: processedData.votingResults.dryVotes,
        recommendation: processedData.votingResults.wateringRecommendation
    }
);
```

**Option B: Modify Frontend to Read from SensorData Collection**
```javascript
// Modify routes/logs.js to use SensorData model instead of Log model
const SensorData = require('../models/SensorData');

router.get('/sensor', async (req, res) => {
    const data = await SensorData.find({ deviceId })
        .sort({ timestamp: -1 })
        .limit(100);
    // Transform format to match Log schema
});
```

---

### Issue 2: **Command Audit Trail Missing**
**Problem**:
- Backend sends PUMP_ON/PUMP_OFF via MQTT
- No database record of commands sent
- Hard to debug "why didn't pump turn on?"

**Solution**: Add command logging
```javascript
// In wateringDecisionEngine.js or secure-cloud-backend.js
const DeviceCommand = require('./models/DeviceCommand');

await DeviceCommand.create({
    deviceId,
    command: 'PUMP_ON',
    duration: 60,
    reason: '3/3 zones below 30% threshold',
    status: 'sent',
    sentAt: new Date()
});
```

---

### Issue 3: **Unused Collections Taking Up Space**
**Problem**:
- `sensors`, `plants`, `notifications` collections exist but unused
- Models defined but no code uses them
- Confusing for maintenance

**Solution Options**:
1. **Remove unused collections** if not planning to use
2. **Implement features** (plant library, notifications)
3. **Document** as "future features" in README

---

## ✅ **RECOMMENDED ACTIONS**

### Priority 1: Fix Logs Collection (CRITICAL)
**Why**: Frontend logs.dart expects data but collection is empty

**Steps**:
1. Add `Log` model require to `secure-cloud-backend.js`
2. Call `Log.logSensor()` after storing sensor data
3. Test logs.dart shows historical data

### Priority 2: Add Command Logging (HIGH)
**Why**: Helps debug automatic watering issues

**Steps**:
1. Add `DeviceCommand` model require to `wateringDecisionEngine.js`
2. Create command record before sending MQTT
3. Update command status when ESP32 acknowledges

### Priority 3: Clean Up Unused Models (MEDIUM)
**Why**: Reduce confusion and maintenance burden

**Steps**:
1. Document unused collections in README
2. Decide: implement features OR remove models
3. Update database schema documentation

---

## 📝 **DATA FLOW DIAGRAM**

```
ESP32 (every 10s)
    ↓
MQTT: ecosprinkle/{deviceId}/sensor
    ↓
secure-cloud-backend.js (Line 182-235)
    ↓
├─ SensorData.save()        ✅ Working
├─ Device.update()          ✅ Working (lastSeen, lastSensorUpdate)
├─ Log.logSensor()          ❌ NOT IMPLEMENTED
├─ WateringDecisionEngine   ✅ Working
│   ↓
│   DeviceCommand.create()  ❌ NOT IMPLEMENTED
│   ↓
│   MQTT: ecosprinkle/{deviceId}/command
│   ↓
│   ESP32 receives PUMP_ON
│
└─ WebSocket.emit()         ✅ Working (frontend real-time updates)
```

---

## 🎯 **WHICH COLLECTIONS ARE ACTUALLY USED?**

### ✅ **ACTIVELY USED (Core System)**
1. **devices** - Device metadata and settings
2. **sensordatas** - Sensor readings (every 10 seconds)
3. **users** - User accounts and authentication

### ⚠️ **PARTIALLY USED (Needs Attention)**
4. **logs** - Read by API but NOT being written to
5. **devicecommands** - Model exists but NOT storing commands

### 🔴 **UNUSED (Legacy/Future)**
6. **sensors** - Model exists but no usage
7. **plants** - Model exists but no usage
8. **notifications** - Model exists but no usage

---

**Recommendation**: Focus on fixing `logs` collection population first, as this affects user-visible features (logs.dart). Then add command logging for debugging. Finally, decide what to do with unused collections.
