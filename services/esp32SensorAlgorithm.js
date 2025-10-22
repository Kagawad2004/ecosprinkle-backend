/**
 * ESP32 Sensor Algorithm Service
 * 
 * This service implements the EXACT SAME algorithm used in the ESP32 firmware
 * to ensure 100% synchronization between device and backend.
 * 
 * ESP32 Firmware Reference: firmware/src/main.cpp
 * Calibration: MIN_ADC=1200 (100% wet), MAX_ADC=2000 (0% dry)
 */

// ESP32 Calibration Constants (MUST match firmware/src/config.h)
const MIN_ADC = 1200; // 100% moisture (fully wet)
const MAX_ADC = 2000; // 0% moisture (completely dry)
const MOISTURE_THRESHOLD = 30; // Below 30% = DRY, needs water

/**
 * Validate sensor data structure from ESP32
 * @param {Object} data - Raw MQTT payload from ESP32
 * @returns {Object} { isValid: boolean, error: string }
 */
function validateSensorData(data) {
    if (!data || typeof data !== 'object') {
        return { isValid: false, error: 'Data is not an object' };
    }

    const required = ['deviceId', 'zone1', 'zone2', 'zone3', 
                     'zone1Percent', 'zone2Percent', 'zone3Percent',
                     'dryVotes', 'wetVotes', 'majorityVoteDry', 
                     'validSensors', 'sensorHealth', 'median', 
                     'pumpState', 'rssi', 'timestamp'];

    for (const field of required) {
        if (!(field in data)) {
            return { isValid: false, error: `Missing required field: ${field}` };
        }
    }

    // Validate ADC ranges (0-4095)
    if (data.zone1 < 0 || data.zone1 > 4095 ||
        data.zone2 < 0 || data.zone2 > 4095 ||
        data.zone3 < 0 || data.zone3 > 4095) {
        return { isValid: false, error: 'ADC values out of range (0-4095)' };
    }

    // Validate percentages (0-100)
    if (data.zone1Percent < 0 || data.zone1Percent > 100 ||
        data.zone2Percent < 0 || data.zone2Percent > 100 ||
        data.zone3Percent < 0 || data.zone3Percent > 100) {
        return { isValid: false, error: 'Moisture percentages out of range (0-100)' };
    }

    return { isValid: true };
}

/**
 * Convert ADC value to moisture percentage (EXACT ESP32 algorithm)
 * @param {number} adc - Raw ADC reading (0-4095)
 * @returns {number} Moisture percentage (0-100)
 */
function adcToMoisturePercent(adc) {
    if (adc <= MIN_ADC) return 100; // Fully wet
    if (adc >= MAX_ADC) return 0;   // Completely dry
    
    // Linear interpolation: 100% at MIN_ADC, 0% at MAX_ADC
    const percent = 100 - ((adc - MIN_ADC) * 100 / (MAX_ADC - MIN_ADC));
    return Math.max(0, Math.min(100, Math.round(percent)));
}

/**
 * Determine sensor status from ADC reading (EXACT ESP32 logic)
 * @param {number} adc - Raw ADC reading
 * @param {number} moisturePercent - Calculated moisture percentage
 * @returns {string} Status: 'WET', 'DRY', or 'ERROR'
 */
function getSensorStatus(adc, moisturePercent) {
    // Check for sensor failure (out of valid range)
    if (adc < 0 || adc > 4095) return 'ERROR';
    
    // Determine wet/dry status
    return moisturePercent > MOISTURE_THRESHOLD ? 'WET' : 'DRY';
}

/**
 * Determine voting decision from moisture level (EXACT ESP32 logic)
 * @param {number} moisturePercent - Moisture percentage
 * @returns {string} Vote: 'WATER', 'NO_WATER', or 'ERROR'
 */
function getVotingDecision(moisturePercent) {
    if (moisturePercent < 0 || moisturePercent > 100) return 'ERROR';
    return moisturePercent <= MOISTURE_THRESHOLD ? 'WATER' : 'NO_WATER';
}

/**
 * Check if sensor reading is valid (not failing)
 * @param {number} adc - Raw ADC reading
 * @returns {boolean} True if sensor is working properly
 */
function isSensorValid(adc) {
    // ESP32 considers sensors invalid if out of expected range
    // or showing extreme values indicating hardware failure
    return adc >= 0 && adc <= 4095;
}

/**
 * Process raw ESP32 sensor data with EXACT firmware algorithm
 * @param {Object} rawData - Raw MQTT payload from ESP32
 * @returns {Object} Processed sensor data with all zones
 */
function processSensorData(rawData) {
    // Process Zone 1
    const zone1 = {
        rawADC: rawData.zone1,
        moisturePercent: rawData.zone1Percent,
        status: getSensorStatus(rawData.zone1, rawData.zone1Percent),
        vote: getVotingDecision(rawData.zone1Percent),
        isValid: isSensorValid(rawData.zone1)
    };

    // Process Zone 2
    const zone2 = {
        rawADC: rawData.zone2,
        moisturePercent: rawData.zone2Percent,
        status: getSensorStatus(rawData.zone2, rawData.zone2Percent),
        vote: getVotingDecision(rawData.zone2Percent),
        isValid: isSensorValid(rawData.zone2)
    };

    // Process Zone 3
    const zone3 = {
        rawADC: rawData.zone3,
        moisturePercent: rawData.zone3Percent,
        status: getSensorStatus(rawData.zone3, rawData.zone3Percent),
        vote: getVotingDecision(rawData.zone3Percent),
        isValid: isSensorValid(rawData.zone3)
    };

    // Voting results (directly from ESP32)
    const votingResults = {
        dryVotes: rawData.dryVotes,
        wetVotes: rawData.wetVotes,
        majorityVoteDry: rawData.majorityVoteDry,
        validSensors: rawData.validSensors,
        medianADC: rawData.median,
        wateringRecommendation: rawData.majorityVoteDry ? 'WATER_NEEDED' : 'NO_WATER_NEEDED'
    };

    // Device status
    const deviceStatus = {
        sensorHealth: rawData.sensorHealth,
        pumpState: rawData.pumpState,
        rssi: rawData.rssi,
        deviceTimestamp: rawData.timestamp
    };

    return {
        deviceId: rawData.deviceId,
        zone1,
        zone2,
        zone3,
        votingResults,
        deviceStatus,
        receivedAt: new Date()
    };
}

/**
 * Calculate average moisture from all valid zones
 * @param {Object} processedData - Processed sensor data
 * @returns {number} Average moisture percentage
 */
function getAverageMoisture(processedData) {
    const validZones = [];
    
    if (processedData.zone1.isValid) validZones.push(processedData.zone1.moisturePercent);
    if (processedData.zone2.isValid) validZones.push(processedData.zone2.moisturePercent);
    if (processedData.zone3.isValid) validZones.push(processedData.zone3.moisturePercent);
    
    if (validZones.length === 0) return 0;
    
    const sum = validZones.reduce((a, b) => a + b, 0);
    return Math.round(sum / validZones.length);
}

module.exports = {
    // Constants
    MIN_ADC,
    MAX_ADC,
    MOISTURE_THRESHOLD,
    
    // Functions
    validateSensorData,
    processSensorData,
    adcToMoisturePercent,
    getSensorStatus,
    getVotingDecision,
    isSensorValid,
    getAverageMoisture
};
