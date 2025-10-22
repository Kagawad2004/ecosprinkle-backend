const express = require('express');
const router = express.Router();
const wateringController = require('../controllers/wateringController');
const auth = require('../middleware/auth');

/**
 * Watering Control Routes
 * Base path: /api/devices/:deviceId
 */

// Switch watering mode (auto/manual/schedule)
router.post('/:deviceId/mode', wateringController.switchMode);

// Manual pump control (on/off) - Only works in manual mode
router.post('/:deviceId/pump', wateringController.controlPump);

// Get current watering state
router.get('/:deviceId/watering-state', wateringController.getWateringState);

// Schedule management
router.post('/:deviceId/schedules', wateringController.upsertSchedule);
router.patch('/:deviceId/schedules/:scheduleId', wateringController.updateScheduleStatus);
router.delete('/:deviceId/schedules/:timeSlotId', wateringController.deleteSchedule);
router.post('/:deviceId/schedule/pause', wateringController.pauseResumeSchedule);
router.post('/:deviceId/schedule/cancel', wateringController.cancelAllSchedules);

// Update schedule execution status
router.post('/:deviceId/schedule-status', wateringController.updateScheduleExecution);

module.exports = router;
