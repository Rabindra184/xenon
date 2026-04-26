/**
 * @swagger
 * /api/devices:
 *   get:
 *     summary: Get all connected devices
 *     description: Retrieve a list of all connected devices with their current status
 *     tags: [Devices]
 *     responses:
 *       200:
 *         description: List of devices
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Device'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/device/{platform}:
 *   get:
 *     summary: Get devices by platform
 *     description: Retrieve devices filtered by platform (ios or android)
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: platform
 *         required: true
 *         schema:
 *           type: string
 *           enum: [ios, android]
 *         description: Device platform
 *     responses:
 *       200:
 *         description: List of devices for the specified platform
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Device'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session:
 *   get:
 *     summary: Get all sessions
 *     description: Retrieve a list of sessions with optional filtering
 *     tags: [Sessions]
 *     parameters:
 *       - in: query
 *         name: buildId
 *         schema:
 *           type: string
 *         description: Filter by build ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [running, success, failed]
 *         description: Filter by session status
 *       - in: query
 *         name: platform
 *         schema:
 *           type: string
 *           enum: [ios, android]
 *         description: Filter by device platform
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         description: Search by session ID, name, device UDID, or device name
 *     responses:
 *       200:
 *         description: List of sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Session'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/build:
 *   get:
 *     summary: Get all builds
 *     description: Retrieve a list of all test builds with session counts
 *     tags: [Builds]
 *     responses:
 *       200:
 *         description: List of builds
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Build'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/session_log:
 *   get:
 *     summary: Get session logs
 *     description: Retrieve Appium command logs for a session
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Session logs
 *       404:
 *         description: Session not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/logs/device:
 *   get:
 *     summary: Get device logs
 *     description: Retrieve device-specific logs for a session
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Device logs
 *       404:
 *         description: Session not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/logs/debug:
 *   get:
 *     summary: Get debug logs
 *     description: Retrieve debug logs for a session
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Debug logs
 *       404:
 *         description: Session not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/profiling:
 *   get:
 *     summary: Get profiling data
 *     description: Retrieve performance profiling data for a session
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Profiling data
 *       404:
 *         description: Session not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/live_video:
 *   get:
 *     summary: Stream live session video
 *     description: Stream live MJPEG video feed for an active session
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: MJPEG stream
 *         content:
 *           multipart/x-mixed-replace:
 *             schema:
 *               type: string
 *               format: binary
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/xenon/analyze:
 *   post:
 *     summary: Analyze current screen
 *     description: Perform an AI-powered visual analysis of the current screen to identify elements and state.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Analysis results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: Session not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/xenon/assert:
 *   post:
 *     summary: Assert visual state
 *     description: Verify the visual state of the screen against a natural language instruction.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [instruction]
 *             properties:
 *               instruction:
 *                 type: string
 *                 description: Natural language assertion (e.g., "The login button is visible")
 *     responses:
 *       200:
 *         description: Assertion results
 *       404:
 *         description: Session not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/xenon/omni-scan:
 *   get:
 *     summary: Perform Omni-Scan
 *     description: Capture a rich AI/OCR-driven scan of the current screen for advanced interaction.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Scan results
 *       404:
 *         description: Session not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/xenon/omni-click:
 *   post:
 *     summary: Omni-Click (OCR-driven click)
 *     description: Click on an element identified by its text using AI/OCR.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 description: Text of the element to click
 *               index:
 *                 type: integer
 *                 default: 0
 *               takeANewScreenShot:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Click successful
 *       404:
 *         description: Session not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/xenon/smart-tap:
 *   post:
 *     summary: Smart Tap (Alias of Omni-Click)
 *     description: Xenon-native alias for performing an OCR-driven smart tap.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 description: Text of the element to tap
 *               index:
 *                 type: integer
 *                 default: 0
 *               takeANewScreenShot:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Tap successful
 *       404:
 *         description: Session not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/session/{sessionId}/xenon/ui-inventory:
 *   post:
 *     summary: UI Inventory Export
 *     description: Export rich UI metadata derived from AI/OCR analysis of the current screen.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               takeANewScreenShot:
 *                 type: boolean
 *                 default: true
 *               maxItems:
 *                 type: integer
 *                 default: 50
 *     responses:
 *       200:
 *         description: UI metadata exported
 *       404:
 *         description: Session not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/tap:
 *   post:
 *     summary: Tap on device screen
 *     description: Perform a tap gesture at the specified coordinates
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [x, y]
 *             properties:
 *               x:
 *                 type: number
 *                 description: X coordinate
 *               y:
 *                 type: number
 *                 description: Y coordinate
 *     responses:
 *       200:
 *         description: Tap successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       404:
 *         description: Device not found
 *       500:
 *         description: Tap failed
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/swipe:
 *   post:
 *     summary: Swipe on device screen
 *     description: Perform a swipe gesture from start to end coordinates
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [x, y, endX, endY]
 *             properties:
 *               x:
 *                 type: number
 *                 description: Start X coordinate
 *               y:
 *                 type: number
 *                 description: Start Y coordinate
 *               endX:
 *                 type: number
 *                 description: End X coordinate
 *               endY:
 *                 type: number
 *                 description: End Y coordinate
 *               duration:
 *                 type: number
 *                 default: 1000
 *                 description: Swipe duration in milliseconds
 *     responses:
 *       200:
 *         description: Swipe successful
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/touchAndHold:
 *   post:
 *     summary: Touch and hold on device screen
 *     description: Perform a long press gesture at the specified coordinates
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [x, y]
 *             properties:
 *               x:
 *                 type: number
 *                 description: X coordinate
 *               y:
 *                 type: number
 *                 description: Y coordinate
 *               duration:
 *                 type: number
 *                 default: 1000
 *                 description: Hold duration in milliseconds
 *     responses:
 *       200:
 *         description: Touch and hold successful
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/text:
 *   post:
 *     summary: Type text on device
 *     description: Enter text on the device at the current focus
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 description: Text to type
 *     responses:
 *       200:
 *         description: Text input successful
 *       404:
 *         description: Device not found
 *       500:
 *         description: Text input failed
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/keyevent:
 *   post:
 *     summary: Send key event
 *     description: Send a key event (e.g., Enter, Back, Home)
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [keyCode]
 *             properties:
 *               keyCode:
 *                 type: string
 *                 description: Key code (e.g., "Enter", "Back", "Home", "Backspace")
 *     responses:
 *       200:
 *         description: Key event sent successfully
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/screenshot:
 *   get:
 *     summary: Capture screenshot
 *     description: Capture a screenshot from the device
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Screenshot captured
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 screenshot:
 *                   type: string
 *                   description: Base64 encoded screenshot
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/clipboard:
 *   get:
 *     summary: Get clipboard content
 *     description: Get the current clipboard content from the device
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Clipboard content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 clipboard:
 *                   type: string
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   post:
 *     summary: Set clipboard content
 *     description: Set the clipboard content on the device
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 description: Content to set to clipboard
 *     responses:
 *       200:
 *         description: Clipboard set successfully
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/stream:
 *   get:
 *     summary: Stream device screen
 *     description: Get a live MJPEG stream of the device screen (no active session required)
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: MJPEG stream
 *         content:
 *           multipart/x-mixed-replace:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/stream/status:
 *   get:
 *     summary: Get stream status
 *     description: Check the current status of the device MJPEG stream
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Stream status information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [running, stopped]
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/stream/start:
 *   post:
 *     summary: Start device stream
 *     description: Initiate high-speed MJPEG streaming for a device
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Stream started successfully
 *       409:
 *         description: Device busy
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/stream/stop:
 *   post:
 *     summary: Stop device stream
 *     description: Terminate the active MJPEG stream for a device
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Stream stopped successfully
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/lock:
 *   post:
 *     summary: Lock device
 *     description: Lock the device screen
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Device locked
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/unlock:
 *   post:
 *     summary: Unlock device
 *     description: Unlock the device screen
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Device unlocked
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/install:
 *   post:
 *     summary: Install app by path
 *     description: Install an application from a file path
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [appPath]
 *             properties:
 *               appPath:
 *                 type: string
 *                 description: Path to the app file
 *     responses:
 *       200:
 *         description: App installed
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/install-repository-app:
 *   post:
 *     summary: Install app from repository
 *     description: Install an application from the Xenon app repository using its ID
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [appId]
 *             properties:
 *               appId:
 *                 type: string
 *                 description: ID of the app in the repository
 *     responses:
 *       200:
 *         description: App installation initiated
 *       404:
 *         description: Device or app not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/upload-install:
 *   post:
 *     summary: Upload and install app
 *     description: Upload an APK/IPA file and install it on the device
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [app]
 *             properties:
 *               app:
 *                 type: string
 *                 format: binary
 *                 description: App file (APK for Android, IPA for iOS)
 *     responses:
 *       200:
 *         description: App installed
 *       400:
 *         description: No file uploaded
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/uninstall:
 *   post:
 *     summary: Uninstall app
 *     description: Uninstall an application from the device
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bundleId]
 *             properties:
 *               bundleId:
 *                 type: string
 *                 description: Bundle ID / Package name of the app
 *     responses:
 *       200:
 *         description: App uninstalled
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/apps:
 *   get:
 *     summary: List installed apps
 *     description: Get a list of installed applications on the device
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: List of installed apps
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   bundleId:
 *                     type: string
 *                   name:
 *                     type: string
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/shell:
 *   post:
 *     summary: Execute shell command
 *     description: Execute a shell command on the device (Android only)
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [command]
 *             properties:
 *               command:
 *                 type: string
 *                 description: Shell command to execute
 *     responses:
 *       200:
 *         description: Command output
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 output:
 *                   type: string
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/omni-scan:
 *   get:
 *     summary: Perform Omni-Scan
 *     description: Perform an AI-powered visual scan of the current screen (no active session required)
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Scan results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 value:
 *                   type: object
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/inspector/snapshot:
 *   get:
 *     summary: Get Inspector snapshot
 *     description: Retrieve a native-first UI inspector snapshot with locator suggestions
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Inspector snapshot
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InspectorSnapshot'
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/control/{udid}/test-locator:
 *   post:
 *     summary: Test AI locator
 *     description: Test an AI-powered locator strategy (ai-text or ai-icon) against the current screen
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [strategy, selector]
 *             properties:
 *               strategy:
 *                 type: string
 *                 enum: [-custom:ai-text, -custom:ai-icon]
 *               selector:
 *                 type: string
 *                 description: Visual description or text to find
 *     responses:
 *       200:
 *         description: Locator match results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 value:
 *                   type: array
 *                   items:
 *                     type: object
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/reservation:
 *   get:
 *     summary: Get all reservations
 *     description: Retrieve a list of all currently reserved devices
 *     tags: [Reservations]
 *     responses:
 *       200:
 *         description: List of reservations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 reservations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Reservation'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   post:
 *     summary: Reserve a device
 *     description: Reserve a device for exclusive use
 *     tags: [Reservations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [udid, host, reservedBy, duration]
 *             properties:
 *               udid:
 *                 type: string
 *                 description: Device UDID
 *               host:
 *                 type: string
 *                 description: Device host
 *               reservedBy:
 *                 type: string
 *                 description: Name of the person reserving
 *               duration:
 *                 type: string
 *                 enum: ['1h', '2h', '4h', '8h']
 *                 description: Reservation duration
 *               reason:
 *                 type: string
 *                 description: Optional reason for reservation
 *     responses:
 *       200:
 *         description: Device reserved successfully
 *       400:
 *         description: Missing required fields or invalid duration
 *       404:
 *         description: Device not found
 *       409:
 *         description: Device already reserved or busy
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/reservation/{udid}/{host}:
 *   delete:
 *     summary: Release reservation
 *     description: Release a device reservation
 *     tags: [Reservations]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *       - in: path
 *         name: host
 *         required: true
 *         schema:
 *           type: string
 *         description: Device host (URL encoded)
 *     responses:
 *       200:
 *         description: Reservation released
 *       400:
 *         description: Device is not reserved
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/reservation/{udid}/{host}/extend:
 *   post:
 *     summary: Extend reservation
 *     description: Extend an existing device reservation
 *     tags: [Reservations]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *       - in: path
 *         name: host
 *         required: true
 *         schema:
 *           type: string
 *         description: Device host (URL encoded)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [duration]
 *             properties:
 *               duration:
 *                 type: string
 *                 enum: ['1h', '2h', '4h', '8h']
 *                 description: Duration to extend by
 *     responses:
 *       200:
 *         description: Reservation extended
 *       400:
 *         description: Device is not reserved or invalid duration
 *       404:
 *         description: Device not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/apps:
 *   get:
 *     summary: Get all apps in repository
 *     description: Retrieve a list of all uploaded applications
 *     tags: [Applications]
 *     responses:
 *       200:
 *         description: List of apps
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/App'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/apps/upload:
 *   post:
 *     summary: Upload an app
 *     description: Upload an APK or IPA file to the app repository
 *     tags: [Applications]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [app]
 *             properties:
 *               app:
 *                 type: string
 *                 format: binary
 *                 description: App file (APK or IPA)
 *     responses:
 *       200:
 *         description: App uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/App'
 *       400:
 *         description: No file uploaded
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/apps/{id}:
 *   delete:
 *     summary: Delete an app
 *     description: Delete an application from the repository
 *     tags: [Applications]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: App ID
 *     responses:
 *       204:
 *         description: App deleted
 *       404:
 *         description: App not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/apps/{id}/download:
 *   get:
 *     summary: Download an app
 *     description: Download an application file from the repository
 *     tags: [Applications]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: App ID
 *     responses:
 *       200:
 *         description: App file
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: App not found
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/queue/length:
 *   get:
 *     summary: Get queue length
 *     description: Get the number of pending session requests in the queue
 *     tags: [Grid]
 *     responses:
 *       200:
 *         description: Queue length
 *         content:
 *           application/json:
 *             schema:
 *               type: integer
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/queue:
 *   get:
 *     summary: Get queued session requests
 *     description: Get all pending session requests in the queue
 *     tags: [Grid]
 *     responses:
 *       200:
 *         description: Queued requests
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/queue/summary:
 *   get:
 *     summary: Get queue summary
 *     description: Get a summary of queued session requests
 *     tags: [Grid]
 *     responses:
 *       200:
 *         description: Queue summary
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/nodes:
 *   get:
 *     summary: Get all nodes
 *     description: Get a list of all registered node hosts
 *     tags: [Grid]
 *     responses:
 *       200:
 *         description: List of node hosts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/device/{udid}/block:
 *   post:
 *     summary: Block a device
 *     description: Block a device from being used for new sessions
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Device blocked
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/device/{udid}/unblock:
 *   post:
 *     summary: Unblock a device
 *     description: Unblock a device to allow new sessions
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema:
 *           type: string
 *         description: Device UDID
 *     responses:
 *       200:
 *         description: Device unblocked
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/webhook:
 *   get:
 *     summary: Get webhook configurations
 *     description: Retrieve all configured webhooks
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: List of webhook configs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/WebhookConfig'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   post:
 *     summary: Add webhook configuration
 *     description: Add a new webhook configuration
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url, events]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: Webhook URL
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Events to subscribe to
 *               type:
 *                 type: string
 *                 enum: [slack, webhook]
 *                 default: slack
 *               payloadTemplate:
 *                 type: string
 *                 description: Optional custom payload template
 *     responses:
 *       200:
 *         description: Webhook added
 *       400:
 *         description: Invalid parameters
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/webhook/{id}:
 *   delete:
 *     summary: Delete webhook configuration
 *     description: Delete a webhook configuration
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Webhook config ID
 *     responses:
 *       200:
 *         description: Webhook deleted
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/webhook/test:
 *   post:
 *     summary: Test webhook
 *     description: Send a test message to a webhook URL
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: Webhook URL to test
 *               type:
 *                 type: string
 *                 enum: [slack, webhook]
 *                 default: slack
 *     responses:
 *       200:
 *         description: Test message sent
 *       500:
 *         description: Test failed
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Get platform configuration
 *     description: Retrieve the global platform configuration
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Configuration object
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   post:
 *     summary: Update platform configuration
 *     description: Update the global platform configuration
 *     tags: [Configuration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Configuration updated
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/config/reset-metrics:
 *   post:
 *     summary: Reset metrics
 *     description: Reset all device and session metrics
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Metrics reset
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/cliArgs:
 *   get:
 *     summary: Get CLI arguments
 *     description: Get the current CLI arguments used to start the plugin
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: CLI arguments
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// This file is only for Swagger documentation - no exports needed
export {};

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Get current configuration
 *     description: Retrieve the current runtime configuration of the Xenon plugin
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Current configuration object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   put:
 *     summary: Update configuration
 *     description: Update plugin configuration properties. Changes are persisted. Some changes may require a server restart.
 *     tags: [Configuration]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Partial configuration object
 *             example:
 *               deviceAvailabilityTimeoutMs: 60000
 *               maxSessions: 5
 *     responses:
 *       200:
 *         description: Configuration updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 restartRequired:
 *                   type: boolean
 *                   description: True if the updated properties require a server restart
 *                 message:
 *                   type: string
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/sessions/active:
 *   get:
 *     summary: Get active sessions
 *     description: Get statistics and list of currently active sessions in memory
 *     tags: [Sessions]
 *     responses:
 *       200:
 *         description: Active session information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stats:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: number
 *                       description: Total number of active sessions
 *                     byType:
 *                       type: object
 *                       properties:
 *                         local:
 *                           type: number
 *                         remote:
 *                           type: number
 *                         cloud:
 *                           type: number
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [local, remote, cloud]
 *                       deviceUdid:
 *                         type: string
 *                       deviceName:
 *                         type: string
 *                       platform:
 *                         type: string
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/logs/requests:
 *   get:
 *     summary: Get HTTP request logs
 *     description: Retrieve recent HTTP request logs for debugging hub-node communication
 *     tags: [Observability]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of logs to return
 *       - in: query
 *         name: method
 *         schema:
 *           type: string
 *           enum: [GET, POST, PUT, DELETE]
 *         description: Filter by HTTP method
 *       - in: query
 *         name: url
 *         schema:
 *           type: string
 *         description: Filter by URL pattern (substring match)
 *       - in: query
 *         name: hasError
 *         schema:
 *           type: boolean
 *         description: Filter by error status (true = only errors, false = only success)
 *     responses:
 *       200:
 *         description: Request logs and statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalLogged:
 *                       type: number
 *                       description: Total requests in buffer
 *                     errorCount:
 *                       type: number
 *                       description: Number of failed requests
 *                     avgDurationMs:
 *                       type: number
 *                       description: Average request duration in milliseconds
 *                     byMethod:
 *                       type: object
 *                       additionalProperties:
 *                         type: number
 *                     byStatusCode:
 *                       type: object
 *                       additionalProperties:
 *                         type: number
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       direction:
 *                         type: string
 *                         enum: [outgoing, incoming]
 *                       method:
 *                         type: string
 *                       url:
 *                         type: string
 *                       statusCode:
 *                         type: number
 *                       durationMs:
 *                         type: number
 *                       error:
 *                         type: string
 *                         nullable: true
 *                       requestBody:
 *                         type: string
 *                         description: Sanitized request body (sensitive data redacted)
 *                       responseBody:
 *                         type: string
 *                         description: Truncated response body
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * tags:
 *   - name: Observability
 *     description: Debugging and monitoring endpoints
 */

/**
 * @swagger
 * /api/healing/selector/state:
 *   post:
 *     summary: Apply a lifecycle action to a selector
 *     description: |
 *       Mutates the SelectorState row for a (strategy, selector) tuple.
 *       Actions are bounded — `mark_fixed`, `mute`, `unmute`,
 *       `cancel_verification`. Returns 409 with `currentStatus` if the
 *       action is incompatible with the row's current state (e.g.
 *       mark_fixed on a muted selector).
 *     tags: [Selector Health]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [original_strategy, original_selector, action]
 *             properties:
 *               original_strategy:
 *                 type: string
 *                 example: accessibility id
 *               original_selector:
 *                 type: string
 *                 example: login-btn
 *               action:
 *                 type: string
 *                 enum: [mark_fixed, mute, unmute, cancel_verification]
 *     responses:
 *       200:
 *         description: Updated SelectorState row
 *       400:
 *         description: Missing fields or unknown action
 *       403:
 *         description: API key lacks `admin` scope
 *       409:
 *         description: Action conflicts with current state (returns currentStatus)
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/healing/state/muted:
 *   get:
 *     summary: List muted selectors
 *     description: |
 *       Returns muted selectors sourced directly from SelectorState
 *       (not the hotspot aggregator), so silenced-but-not-recently-healed
 *       rows still surface. Each row is enriched with the most recent
 *       `is_healed=true` SessionLog timestamp for the tuple.
 *     tags: [Selector Health]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Paginated muted selectors
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 muted: { type: array }
 *                 total: { type: integer }
 *                 limit: { type: integer }
 *                 offset: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/healing/state/{strategy}/{value}:
 *   get:
 *     summary: Look up SelectorState for a single tuple
 *     description: |
 *       URL-encoded strategy + value. Returns `{ state: null }` when no
 *       row exists — null is meaningful (the selector is implicitly Active).
 *     tags: [Selector Health]
 *     parameters:
 *       - in: path
 *         name: strategy
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: value
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: SelectorState row, or null
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/healing/hotspots:
 *   get:
 *     summary: List the most-healed selectors (with lifecycle filter)
 *     description: |
 *       Status filter is `active` (default), `pending`, `resolved`, `muted`,
 *       or `all`. The default value transparently hides muted/pending/
 *       resolved selectors from the live list, the CI gate, and the digest.
 *     tags: [Selector Health]
 *     parameters:
 *       - in: query
 *         name: windowDays
 *         schema: { type: integer, default: 30 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, pending, resolved, muted, all], default: active }
 *       - in: query
 *         name: tier
 *         schema: { type: string }
 *       - in: query
 *         name: platform
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Hotspots with state overlay
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// =============================================================================
// Health & Operations
// =============================================================================

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Liveness probe
 *     description: |
 *       Public, unauthenticated, not rate-limited. Returns `{ ok: true }` as soon
 *       as the Express stack is up — does not check database or device state.
 *       Suitable for Kubernetes/load-balancer liveness probes.
 *     tags: [Health & Ops]
 *     security: []
 *     responses:
 *       200:
 *         description: Server is up
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, example: true }
 */

/**
 * @swagger
 * /api/ping:
 *   get:
 *     summary: Authenticated ping with build version
 *     description: Returns `{ pong, version }`. Use to confirm an API key is valid and read the running plugin version.
 *     tags: [Health & Ops]
 *     responses:
 *       200:
 *         description: Pong with version
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pong: { type: boolean, example: true }
 *                 version: { type: string, example: '1.5.0' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/metrics:
 *   get:
 *     summary: Prometheus-format metrics
 *     description: |
 *       Returns scrape-friendly Prometheus exposition format (`text/plain; version=0.0.4`).
 *       Auth-gated to avoid operational reconnaissance — point your scraper at this
 *       endpoint with a `read`-scope key in the `x-xenon-api-key` header.
 *     tags: [Health & Ops]
 *     responses:
 *       200:
 *         description: Prometheus metrics
 *         content:
 *           text/plain:
 *             schema: { type: string }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/cliArgs:
 *   get:
 *     summary: Read the plugin CLI arguments in effect
 *     description: |
 *       Returns the resolved plugin arguments (host, hub URL, platform, intervals, etc.)
 *       this process was started with. Sensitive fields (`nodeSecret`, database URLs)
 *       are redacted by the logger but the raw object is returned over the wire to
 *       authenticated callers — do not expose this endpoint to untrusted networks.
 *     tags: [Health & Ops]
 *     responses:
 *       200:
 *         description: Resolved plugin arguments
 *         content:
 *           application/json:
 *             schema: { type: object, additionalProperties: true }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// =============================================================================
// Authentication
// =============================================================================

/**
 * @swagger
 * /api/auth/dashboard-session:
 *   post:
 *     summary: Exchange an API key for a browser dashboard session cookie
 *     description: |
 *       Used by the dashboard UI to convert a one-time API key paste into a
 *       short-lived session cookie. Public endpoint — no API key header is
 *       required because the body itself carries the credential. On success,
 *       sets `xenon_dashboard_session` (HttpOnly, Secure, SameSite=Strict, 24 h
 *       max-age). Subsequent dashboard requests use the cookie instead of the
 *       header. CSRF protection: cookie-authed callers must send a matching
 *       `Origin`/`Referer`.
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [apiKey]
 *             properties:
 *               apiKey: { type: string, description: 'Plain-text API key' }
 *     responses:
 *       200:
 *         description: Session cookie set
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, example: true }
 *                 scopes:
 *                   type: array
 *                   items: { type: string, enum: [read, sessions, devices, admin] }
 *       400: { description: 'Missing apiKey field' }
 *       401: { description: 'Invalid API key' }
 */

// =============================================================================
// Admin — API Keys
// =============================================================================

/**
 * @swagger
 * /api/apikeys:
 *   get:
 *     summary: List all API keys
 *     description: Returns metadata only — the plain-text key value is never returned after creation. Requires `admin` scope.
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: List of API key records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   scopes:
 *                     type: array
 *                     items: { type: string, enum: [read, sessions, devices, admin] }
 *                   rateLimit: { type: integer, nullable: true }
 *                   teamId: { type: string, nullable: true }
 *                   createdAt: { type: string, format: date-time }
 *                   lastUsedAt: { type: string, format: date-time, nullable: true }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   post:
 *     summary: Mint a new API key
 *     description: |
 *       Returns the plain-text key **once** in the response. Store it immediately —
 *       it cannot be retrieved later. Requires `admin` scope.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, scopes]
 *             properties:
 *               name: { type: string, example: 'CI runner' }
 *               scopes:
 *                 type: array
 *                 minItems: 1
 *                 items: { type: string, enum: [read, sessions, devices, admin] }
 *               rateLimit:
 *                 type: integer
 *                 description: 'Per-window quota override; null inherits the plugin default'
 *               teamId:
 *                 type: string
 *                 nullable: true
 *                 description: 'Bind this key to a team (so it sees team-owned devices only)'
 *     responses:
 *       200:
 *         description: Key created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 key: { type: string, description: 'Plain-text key — shown once' }
 *       400: { description: 'Missing name or empty scopes array' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/apikeys/{id}:
 *   delete:
 *     summary: Revoke an API key
 *     description: Hard-deletes the key. In-flight requests already authenticated continue until completion; subsequent requests with the revoked key get 401. Requires `admin` scope.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Key revoked
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// =============================================================================
// Admin — Teams
// =============================================================================

/**
 * @swagger
 * /api/teams:
 *   get:
 *     summary: List all teams
 *     description: Requires `admin` scope.
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: List of teams
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   createdAt: { type: string, format: date-time }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   post:
 *     summary: Create a team
 *     description: Team names must be unique. Requires `admin` scope.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: 'Mobile Platform' }
 *     responses:
 *       200:
 *         description: Team created
 *       400: { description: 'Missing name' }
 *       409: { description: 'Team name already exists' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/teams/{id}:
 *   delete:
 *     summary: Delete a team
 *     description: Cascades to membership rows. Devices owned by the team revert to shared (null) ownership. Requires `admin` scope.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Team deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/teams/{id}/members:
 *   get:
 *     summary: List team members
 *     description: Returns the API keys bound to this team. Requires `admin` scope.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of members
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   apiKeyId: { type: string }
 *                   role: { type: string, enum: [member, owner] }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   post:
 *     summary: Add a member to a team
 *     description: Adds an existing API key as a team member. Defaults to `member` role. Requires `admin` scope.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [apiKeyId]
 *             properties:
 *               apiKeyId: { type: string }
 *               role: { type: string, enum: [member, owner], default: member }
 *     responses:
 *       200: { description: 'Member added' }
 *       400: { description: 'Missing apiKeyId' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/teams/{id}/members/{apiKeyId}:
 *   delete:
 *     summary: Remove a member from a team
 *     description: Does not revoke the API key itself — only unbinds it from the team. Requires `admin` scope.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: apiKeyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Member removed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// =============================================================================
// Admin — Process snapshot
// =============================================================================

/**
 * @swagger
 * /api/processes:
 *   get:
 *     summary: Snapshot of long-running child processes
 *     description: |
 *       Lists the long-lived workers Xenon is currently supervising — Appium-driven
 *       sessions, ADB log tails, MJPEG stream encoders, etc. Useful when triaging
 *       why a host is hot or a device is wedged. Requires `admin` scope.
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: List of supervised processes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   sessionId: { type: string, nullable: true }
 *                   udid: { type: string, nullable: true }
 *                   kind: { type: string, example: 'mjpeg-stream' }
 *                   pid: { type: integer }
 *                   uptimeMs: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// =============================================================================
// Network Interceptor
// =============================================================================

/**
 * @swagger
 * /api/interceptor/sessions/{sessionId}/requests:
 *   get:
 *     summary: List intercepted HTTP requests for a session
 *     description: |
 *       Returns the full list of requests captured by the per-session interceptor.
 *       If the session is still active, results are read live; otherwise the
 *       archived `requests.json` from the session asset directory is replayed.
 *       Returns 404 when neither a live interceptor nor an archive exists.
 *     tags: [Network Interceptor]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Request list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requests:
 *                   type: array
 *                   items: { type: object, additionalProperties: true }
 *       404: { description: 'Interceptor inactive and no archive on disk' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/interceptor/sessions/{sessionId}/requests/{requestId}:
 *   get:
 *     summary: Get a single intercepted request with full body
 *     description: |
 *       Hydrates the request detail, including any response body that was
 *       offloaded to disk (`bodyPath`). Use this from the dashboard's request
 *       drawer or for HAR-equivalent single-record export.
 *     tags: [Network Interceptor]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Single request entry
 *         content:
 *           application/json:
 *             schema: { type: object, additionalProperties: true }
 *       404: { description: 'Request not found in live or archived state' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/interceptor/sessions/{sessionId}/har:
 *   get:
 *     summary: Export session traffic as a HAR file
 *     description: |
 *       Returns a HAR 1.2 archive (`application/json`, with `Content-Disposition:
 *       attachment`). Falls back to the on-disk archive if the session has ended.
 *     tags: [Network Interceptor]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: HAR file
 *         content:
 *           application/json:
 *             schema: { type: object, additionalProperties: true }
 *       404: { description: 'No live interceptor and no archived HAR' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/interceptor/sessions/{sessionId}/mocks:
 *   get:
 *     summary: List mock rules for a session
 *     description: Mock rules apply only while the session is live — there is no archive fallback.
 *     tags: [Network Interceptor]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Mock list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mocks:
 *                   type: array
 *                   items: { type: object, additionalProperties: true }
 *       404: { description: 'Interceptor not active for this session' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   post:
 *     summary: Add a mock rule
 *     description: |
 *       Mock rules match by URL pattern and method, then either return a static
 *       response, rewrite the upstream response, or delay it. Only valid while
 *       the target session is live.
 *     tags: [Network Interceptor]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, additionalProperties: true }
 *     responses:
 *       201:
 *         description: Mock created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *       400: { description: 'Invalid mock rule' }
 *       404: { description: 'Interceptor not active' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 *   delete:
 *     summary: Clear all mock rules for a session
 *     tags: [Network Interceptor]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Mocks cleared
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
 *       404: { description: 'Interceptor not active' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/interceptor/sessions/{sessionId}/mocks/{mockId}:
 *   delete:
 *     summary: Remove a single mock rule
 *     tags: [Network Interceptor]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: mockId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Mock removed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 removed: { type: boolean }
 *       404: { description: 'Interceptor not active or mock not found' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// =============================================================================
// Hub-Node channel (node-secret auth)
// =============================================================================

/**
 * @swagger
 * /api/register:
 *   post:
 *     summary: Node→Hub device inventory push
 *     description: |
 *       Hub-node only. Authenticates with `x-xenon-node-secret`, not an API key.
 *       Nodes call this on startup and on a recurring interval
 *       (`sendNodeDevicesToHubIntervalMs`, default 30 s) to publish their device
 *       list. The `type` query param selects the operation:
 *
 *       | type          | effect                                                        |
 *       |---------------|---------------------------------------------------------------|
 *       | `add`         | Insert / refresh the supplied devices                         |
 *       | `remove`      | Drop the supplied devices (e.g. USB unplug)                   |
 *       | `unregister`  | Drop every device for the calling host (used on graceful exit) |
 *
 *       Not intended for end-user automation. Document here for transparency.
 *     tags: [Hub-Node]
 *     security:
 *       - NodeSecretAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema: { type: string, enum: [add, remove, unregister] }
 *       - in: query
 *         name: host
 *         schema: { type: string }
 *         description: 'Required for `unregister`'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: array
 *                 items: { $ref: '#/components/schemas/Device' }
 *               - type: object
 *     responses:
 *       200:
 *         description: Inventory accepted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
 *       401: { description: 'Missing or invalid x-xenon-node-secret' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/unblock:
 *   post:
 *     summary: Node→Hub release of a manually-blocked device
 *     description: |
 *       Hub-node only. Authenticates with `x-xenon-node-secret`. Nodes call this
 *       to re-enter a device into the pool after a maintenance lock or a blocked
 *       state lifted on the node side. Returns 404 if the (udid, host) tuple is
 *       not in the registry.
 *     tags: [Hub-Node]
 *     security:
 *       - NodeSecretAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [udid, host]
 *             properties:
 *               udid: { type: string }
 *               host: { type: string }
 *     responses:
 *       200:
 *         description: Device unblocked
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
 *       404: { description: 'Device not found in registry' }
 *       401: { description: 'Missing or invalid x-xenon-node-secret' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// =============================================================================
// Grid — previously-undocumented routes
// =============================================================================

/**
 * @swagger
 * /api/device/tags:
 *   post:
 *     summary: Replace the tag list on a device
 *     description: Tags are user-defined free-form labels (e.g. `flaky`, `lab-row-3`). Replaces — does not append. Requires `devices` scope.
 *     tags: [Devices]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [udid, host, tags]
 *             properties:
 *               udid: { type: string }
 *               host: { type: string }
 *               tags:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Tags updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
 *       400: { description: 'Missing udid, host, or tags array' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/device/{udid}/team:
 *   put:
 *     summary: Assign (or clear) a device's team ownership
 *     description: |
 *       Pass `teamId: null` to unassign the device (it returns to the shared
 *       pool, visible to all keys). Pass a string id to bind it. The team must
 *       already exist. Requires `admin` scope.
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [teamId]
 *             properties:
 *               teamId: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Team ownership updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 updated: { type: integer }
 *       404: { description: 'Team or device not found' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/queue/status/{capability_id}:
 *   get:
 *     summary: Status of a single queued session request
 *     description: |
 *       Returns the queue position and ETA for a pending session keyed by the
 *       capability id you submitted. 404 if the request has already been
 *       allocated or expired.
 *     tags: [Grid]
 *     parameters:
 *       - in: path
 *         name: capability_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Queue status
 *         content:
 *           application/json:
 *             schema: { type: object, additionalProperties: true }
 *       404: { description: 'Pending session not found' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/node/{host}/status:
 *   get:
 *     summary: ADB / device status for a specific node
 *     description: |
 *       If `host` matches the node serving the request, the response is built
 *       locally. Otherwise the hub proxies the call to that node's
 *       `/api/node/status` endpoint and returns the result. Returns 404 if no
 *       devices are registered for the requested host.
 *     tags: [Grid]
 *     parameters:
 *       - in: path
 *         name: host
 *         required: true
 *         schema: { type: string }
 *         description: 'Node host (URL or hostname as registered with the hub)'
 *     responses:
 *       200:
 *         description: Per-device status
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   udid: { type: string }
 *                   host: { type: string }
 *                   state: { type: string }
 *                   platform: { type: string, enum: [ios, android] }
 *       404: { description: 'No devices registered for that host' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// =============================================================================
// Selector Health — previously-undocumented routes
// =============================================================================

/**
 * @swagger
 * /api/healing/events:
 *   get:
 *     summary: Recent healing events
 *     description: |
 *       Returns the most recent self-healing events along with a `todayCount`
 *       used by the dashboard "today" badge. Newest first; clamped to 1–200.
 *     tags: [Selector Health]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *     responses:
 *       200:
 *         description: Recent events
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 events:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       sessionId: { type: string }
 *                       deviceUdid: { type: string }
 *                       deviceName: { type: string }
 *                       devicePlatform: { type: string, enum: [ios, android] }
 *                       commandName: { type: string }
 *                       originalSelector: { type: string }
 *                       healedSelector: { type: string }
 *                       confidence: { type: number }
 *                       tier: { type: string }
 *                       isSuccess: { type: boolean }
 *                       createdAt: { type: string, format: date-time }
 *                 todayCount: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/healing/summary:
 *   get:
 *     summary: Selector-health KPI summary with prior-period comparison
 *     description: |
 *       Aggregates over `windowDays` (clamped 1–365, default 30) and emits a
 *       parallel "prior" object covering the equivalent immediately-preceding
 *       window — use the diff for week-over-week / month-over-month deltas.
 *     tags: [Selector Health]
 *     parameters:
 *       - in: query
 *         name: windowDays
 *         schema: { type: integer, minimum: 1, maximum: 365, default: 30 }
 *     responses:
 *       200:
 *         description: KPI summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 windowDays: { type: integer }
 *                 current:
 *                   type: object
 *                   properties:
 *                     totalHeals: { type: integer }
 *                     distinctSelectors: { type: integer }
 *                     sessionsTouched: { type: integer }
 *                     byTier: { type: object, additionalProperties: { type: integer } }
 *                     estCostUsd: { type: number }
 *                 prior:
 *                   type: object
 *                   description: 'Same shape as `current` for the immediately preceding window'
 *                 resolvedCount: { type: integer }
 *                 pendingCount: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

/**
 * @swagger
 * /api/healing/digest/send:
 *   post:
 *     summary: On-demand selector-health digest webhook
 *     description: |
 *       Manually fires the digest that the scheduler normally sends on a fixed
 *       cadence. Useful for pre-release "is the selector landscape healthy
 *       enough to ship?" gates. Requires `admin` scope.
 *     tags: [Selector Health]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               windowDays: { type: integer }
 *               limit: { type: integer }
 *               minHealCount: { type: integer }
 *     responses:
 *       200:
 *         description: Digest dispatched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sent: { type: integer, description: 'Number of webhook subscribers fired' }
 *                 windowDays: { type: integer }
 *                 hotspotsIncluded: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */

// =============================================================================
// Control — previously-undocumented routes
// =============================================================================

/**
 * @swagger
 * /api/control/{udid}/logs:
 *   get:
 *     summary: Pull recent device logs
 *     description: |
 *       Android: `adb logcat -d` style snapshot. iOS: recent syslog buffer.
 *       Returns plain text wrapped in a JSON `logs` field.
 *     tags: [Control]
 *     parameters:
 *       - in: path
 *         name: udid
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Device logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs: { type: string }
 *       404: { description: 'Device not found' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
