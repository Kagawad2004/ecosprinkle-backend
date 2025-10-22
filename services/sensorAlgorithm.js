/**
 * EcoSprinkler Sensor Algorithm Service
 * 
 * This service replicates the EXACT sensor processing algorithm from ESP32 firmware (main.cpp)
 * to ensure 100% synchronization between device and backend processing.
 * 
 * ESP32 Calibration Values:
 * - MIN_ADC = 1200 (WET - fully soaked soil)
 * - MAX_ADC = 2000 (DRY - sensor in air)
 * - ADC_RANGE = 800
 * 
 * Display Logic (Normal UX):
 * - 100% = WET (1200 ADC)
 * - 0% = DRY (2000 ADC)
 * 
 * Thresholds:
 * - dryThresholdPercent = 20% (Water when below 20%)
 * - wetThresholdPercent = 80% (Stop watering when above 80%)
 * 
 * Voting System:
 * - Each of 3 sensors votes independently: DRY or WET
 * - Majority decision (2 out of 3) determines watering action
 * - Handles sensor failures gracefully
 */

// ============ ESP32 CALIBRATION CONSTANTS ============
const SENSOR_CALIBRATION = {
  MIN_ADC: 1200,        // WET (fully soaked) - LOW ADC value
  MAX_ADC: 2000,        // DRY (in air) - HIGH ADC value
  ADC_RANGE: 800,       // MAX_ADC - MIN_ADC
  
  // Error detection thresholds
  SENSOR_ERROR_LOW: 100,    // Below this = sensor disconnected
  SENSOR_ERROR_HIGH: 2700,  // Above this = sensor disconnected
};

// ============ THRESHOLD CONSTANTS ============
const THRESHOLDS = {
  dryThresholdPercent: 20,   // Water when display shows < 20%
  wetThresholdPercent: 80,   // Stop when display shows > 80%
  
  // Converted to ADC values for internal use
  dryThresholdADC: 1840,     // percentToAdc(20) = 1840
  wetThresholdADC: 1360,     // percentToAdc(80) = 1360
};

/**
 * Convert ADC value to moisture percentage
 * EXACT replica of ESP32 adcToPercent() function
 * 
 * @param {number} adcValue - Raw ADC reading (0-4095)
 * @returns {number} Moisture percentage (0-100)
 * 
 * Logic:
 * - Lower ADC (1200) → 100% (wet/soaked)
 * - Higher ADC (2000) → 0% (dry/air)
 * - NORMAL UX: Higher % = Wetter soil (what users expect!)
 */
function adcToPercent(adcValue) {
  const { MIN_ADC, MAX_ADC, ADC_RANGE } = SENSOR_CALIBRATION;
  
  // Clamp ADC value to realistic range
  let clampedValue = adcValue;
  if (clampedValue < MIN_ADC) clampedValue = MIN_ADC;
  if (clampedValue > MAX_ADC) clampedValue = MAX_ADC;
  
  // NORMAL UX DISPLAY: Higher % = Wetter soil
  // Formula: 100 - (((ADC - MIN) * 100) / RANGE)
  const percent = 100 - (((clampedValue - MIN_ADC) * 100) / ADC_RANGE);
  
  return Math.round(percent);
}

/**
 * Convert moisture percentage to ADC value
 * EXACT replica of ESP32 percentToAdc() function
 * 
 * @param {number} percent - Moisture percentage (0-100)
 * @returns {number} ADC value (1200-2000)
 * 
 * Logic:
 * - 100% (wet) → 1200 ADC (low)
 * - 0% (dry) → 2000 ADC (high)
 */
function percentToAdc(percent) {
  const { MIN_ADC, MAX_ADC, ADC_RANGE } = SENSOR_CALIBRATION;
  
  // Clamp percentage to 0-100
  let clampedPercent = percent;
  if (clampedPercent < 0) clampedPercent = 0;
  if (clampedPercent > 100) clampedPercent = 100;
  
  // Convert percentage back to ADC
  // Formula: MAX_ADC - ((percent * RANGE) / 100)
  const adc = MAX_ADC - ((clampedPercent * ADC_RANGE) / 100);
  
  return Math.round(adc);
}

/**
 * Check if sensor reading is valid (not disconnected/failed)
 * EXACT replica of ESP32 sensor validation logic
 * 
 * @param {number} adcValue - Raw ADC reading
 * @returns {boolean} true if sensor is valid, false if failed
 */
function isSensorValid(adcValue) {
  const { SENSOR_ERROR_LOW, SENSOR_ERROR_HIGH } = SENSOR_CALIBRATION;
  return adcValue > SENSOR_ERROR_LOW && adcValue < SENSOR_ERROR_HIGH;
}

/**
 * Get sensor vote based on moisture percentage
 * EXACT replica of ESP32 voting logic
 * 
 * @param {number} moisturePercent - Moisture percentage (0-100)
 * @returns {string} 'DRY' (needs water), 'WET' (no water), or 'NEUTRAL' (moderate)
 */
function getSensorVote(moisturePercent) {
  const { dryThresholdPercent, wetThresholdPercent } = THRESHOLDS;
  
  // Water when percentage BELOW 20% (dryThresholdPercent)
  if (moisturePercent <= dryThresholdPercent) {
    return 'DRY'; // Vote: WATER NEEDED
  }
  
  // Stop watering when percentage ABOVE 80% (wetThresholdPercent)
  if (moisturePercent >= wetThresholdPercent) {
    return 'WET'; // Vote: NO WATER NEEDED
  }
  
  // Between thresholds - neutral vote (doesn't count)
  return 'NEUTRAL';
}

/**
 * Get sensor status label
 * 
 * @param {number} moisturePercent - Moisture percentage (0-100)
 * @returns {string} 'WET', 'DRY', or 'MODERATE'
 */
function getSensorStatus(moisturePercent) {
  const { dryThresholdPercent, wetThresholdPercent } = THRESHOLDS;
  
  if (moisturePercent <= dryThresholdPercent) return 'DRY';
  if (moisturePercent >= wetThresholdPercent) return 'WET';
  return 'MODERATE';
}

/**
 * Calculate median of three values
 * Used for outlier detection in ESP32
 * 
 * @param {number} a - First value
 * @param {number} b - Second value
 * @param {number} c - Third value
 * @returns {number} Median value
 */
function calculateMedian(a, b, c) {
  const values = [a, b, c].sort((x, y) => x - y);
  return values[1]; // Middle value
}

/**
 * Process all sensor data using ESP32 majority voting algorithm
 * EXACT replica of ESP32 readSensors() function logic
 * 
 * @param {Object} sensorData - Raw sensor data from ESP32
 * @param {string} sensorData.deviceId - Device identifier
 * @param {number} sensorData.zone1 - Zone 1 raw ADC value
 * @param {number} sensorData.zone2 - Zone 2 raw ADC value
 * @param {number} sensorData.zone3 - Zone 3 raw ADC value
 * @param {number} sensorData.timestamp - Device timestamp (ms since boot)
 * @param {number} [sensorData.pumpState] - Current pump state (0=OFF, 1=ON)
 * @param {number} [sensorData.rssi] - WiFi signal strength
 * 
 * @returns {Object} Processed sensor data with voting results
 */
function processSensorData(sensorData) {
  const { zone1, zone2, zone3, deviceId, timestamp, pumpState = 0, rssi = 0 } = sensorData;
  
  // ========== CONVERT ADC TO PERCENTAGES ==========
  const zone1Percent = adcToPercent(zone1);
  const zone2Percent = adcToPercent(zone2);
  const zone3Percent = adcToPercent(zone3);
  
  // ========== VALIDATE SENSORS ==========
  const zone1Valid = isSensorValid(zone1);
  const zone2Valid = isSensorValid(zone2);
  const zone3Valid = isSensorValid(zone3);
  
  // ========== MAJORITY VOTING LOGIC ==========
  let dryVotes = 0;
  let wetVotes = 0;
  let validSensors = 0;
  let lastValidReading = 0;
  
  const zones = [];
  
  // Zone 1 Vote
  if (zone1Valid) {
    validSensors++;
    lastValidReading = zone1;
    const vote = getSensorVote(zone1Percent);
    const status = getSensorStatus(zone1Percent);
    
    if (vote === 'DRY') dryVotes++;
    else if (vote === 'WET') wetVotes++;
    
    zones.push({
      zoneNumber: 1,
      rawADC: zone1,
      moisturePercent: zone1Percent,
      status: status,
      vote: vote,
      isValid: true
    });
  } else {
    zones.push({
      zoneNumber: 1,
      rawADC: zone1,
      moisturePercent: 0,
      status: 'ERROR',
      vote: 'ERROR',
      isValid: false
    });
  }
  
  // Zone 2 Vote
  if (zone2Valid) {
    validSensors++;
    lastValidReading = zone2;
    const vote = getSensorVote(zone2Percent);
    const status = getSensorStatus(zone2Percent);
    
    if (vote === 'DRY') dryVotes++;
    else if (vote === 'WET') wetVotes++;
    
    zones.push({
      zoneNumber: 2,
      rawADC: zone2,
      moisturePercent: zone2Percent,
      status: status,
      vote: vote,
      isValid: true
    });
  } else {
    zones.push({
      zoneNumber: 2,
      rawADC: zone2,
      moisturePercent: 0,
      status: 'ERROR',
      vote: 'ERROR',
      isValid: false
    });
  }
  
  // Zone 3 Vote
  if (zone3Valid) {
    validSensors++;
    lastValidReading = zone3;
    const vote = getSensorVote(zone3Percent);
    const status = getSensorStatus(zone3Percent);
    
    if (vote === 'DRY') dryVotes++;
    else if (vote === 'WET') wetVotes++;
    
    zones.push({
      zoneNumber: 3,
      rawADC: zone3,
      moisturePercent: zone3Percent,
      status: status,
      vote: vote,
      isValid: true
    });
  } else {
    zones.push({
      zoneNumber: 3,
      rawADC: zone3,
      moisturePercent: 0,
      status: 'ERROR',
      vote: 'ERROR',
      isValid: false
    });
  }
  
  // ========== CALCULATE MEDIAN (for outlier detection) ==========
  const medianADC = calculateMedian(zone1, zone2, zone3);
  
  // ========== DETERMINE MAJORITY DECISION ==========
  // Majority rule: 2 out of 3 sensors must agree
  // If 2+ sensors vote DRY → Water needed (majorityVoteDry = true)
  // If 2+ sensors vote WET → No water needed (majorityVoteDry = false)
  // If votes are split (1-1) or neutral → Default to DRY (safe to water)
  const majorityVoteDry = dryVotes >= 2;
  
  // ========== DETERMINE OVERALL SENSOR HEALTH ==========
  let sensorHealth = 'normal';
  if (validSensors === 0) {
    sensorHealth = 'error'; // All sensors failed
  } else if (validSensors < 3) {
    sensorHealth = 'warning'; // Some sensors failed
  }
  
  // ========== WATERING DECISION ==========
  const wateringRecommendation = majorityVoteDry ? 'WATER_NEEDED' : 'NO_WATER_NEEDED';
  
  // ========== RETURN PROCESSED DATA ==========
  return {
    deviceId,
    timestamp: new Date(timestamp), // Convert to Date object
    receivedAt: new Date(), // Server timestamp
    
    // Raw sensor data
    zones,
    
    // Voting results
    votingResults: {
      dryVotes,
      wetVotes,
      majorityVoteDry,
      validSensors,
      medianADC,
      wateringRecommendation
    },
    
    // Device status
    deviceStatus: {
      pumpState,
      rssi,
      sensorHealth,
      deviceTimestamp: timestamp
    },
    
    // Individual zone summaries (for easy access)
    zone1: {
      rawADC: zone1,
      moisturePercent: zone1Percent,
      status: zones[0].status,
      vote: zones[0].vote,
      isValid: zone1Valid
    },
    zone2: {
      rawADC: zone2,
      moisturePercent: zone2Percent,
      status: zones[1].status,
      vote: zones[1].vote,
      isValid: zone2Valid
    },
    zone3: {
      rawADC: zone3,
      moisturePercent: zone3Percent,
      status: zones[2].status,
      vote: zones[2].vote,
      isValid: zone3Valid
    }
  };
}

/**
 * Validate incoming ESP32 sensor data structure
 * 
 * @param {Object} data - Raw data from ESP32
 * @returns {Object} { isValid: boolean, error?: string }
 */
function validateSensorData(data) {
  if (!data.deviceId) {
    return { isValid: false, error: 'Missing deviceId' };
  }
  
  if (typeof data.zone1 !== 'number' || typeof data.zone2 !== 'number' || typeof data.zone3 !== 'number') {
    return { isValid: false, error: 'Missing or invalid zone ADC values' };
  }
  
  if (typeof data.timestamp !== 'number') {
    return { isValid: false, error: 'Missing or invalid timestamp' };
  }
  
  return { isValid: true };
}

// ============ EXPORTS ============
module.exports = {
  // Core functions
  adcToPercent,
  percentToAdc,
  isSensorValid,
  getSensorVote,
  getSensorStatus,
  calculateMedian,
  processSensorData,
  validateSensorData,
  
  // Constants
  SENSOR_CALIBRATION,
  THRESHOLDS
};
