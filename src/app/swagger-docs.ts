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
 */

// This file is only for Swagger documentation - no exports needed
export { };

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
 */

/**
 * @swagger
 * tags:
 *   - name: Observability
 *     description: Debugging and monitoring endpoints
 */
