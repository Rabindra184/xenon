import sharp from 'sharp';

/**
 * OCR and the AI find things in a screenshot, in its pixels. A driver taps
 * (W3C actions) and reports element rects in its own coordinates:
 *
 * - UiAutomator2 (Android): the screen's pixels, the screenshot's own.
 * - XCUITest (iOS, tvOS): points. An iPhone's screenshot is 2x or 3x its
 *   window in points, so a tap at a pixel position lands 2-3 times too far
 *   right and down.
 *
 * This converts a position found in a screenshot into the driver's
 * coordinates. Through 2.13.2 nothing did: smartTap, visualTap, the
 * -custom:ai-* locators' elements and the OCR and Visual AI healing tiers all
 * tapped iPhones at pixel positions.
 */

/** Screenshot pixels per driver coordinate, on each axis. */
export interface ScreenScale {
  x: number;
  y: number;
}

export const SAME_SCALE: ScreenScale = { x: 1, y: 1 };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whether the driver's coordinates are points rather than the screenshot's
 * pixels. A driver Xenon can't place (device control's screenshot-only
 * stand-in, which never taps) keeps pixels.
 */
export function driverUsesPoints(driver: any): boolean {
  const platform = String(driver?.caps?.platformName ?? driver?.opts?.platformName ?? '');
  return ['ios', 'tvos'].includes(platform.toLowerCase());
}

/**
 * The scale between `screenshotBase64` and the driver's coordinates:
 * 1 unless the driver uses points, then the screenshot's size over the
 * window's. Throws when that can't be worked out on a driver that uses
 * points, since a tap in pixels there lands in the wrong place.
 */
export async function screenScaleOf(driver: any, screenshotBase64: string): Promise<ScreenScale> {
  if (!driverUsesPoints(driver)) return SAME_SCALE;

  const image = await sharp(Buffer.from(screenshotBase64, 'base64'))
    .metadata()
    .catch((err: Error) => {
      throw new Error(`The screenshot's size could not be read: ${err.message}`);
    });
  const window =
    typeof driver.getWindowRect === 'function'
      ? await driver.getWindowRect()
      : await driver.getWindowSize();

  const x = Number(image.width) / Number(window?.width);
  const y = Number(image.height) / Number(window?.height);
  if (!(Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0)) {
    throw new Error(
      `The screen size could not be worked out (screenshot ${image.width}x${image.height}, ` +
        `window ${window?.width}x${window?.height}).`,
    );
  }
  return { x, y };
}

/** A rect found in the screenshot, in the driver's coordinates. */
export function toDriverRect(rect: Rect, scale: ScreenScale): Rect {
  if (scale.x === 1 && scale.y === 1) return rect;
  return {
    x: rect.x / scale.x,
    y: rect.y / scale.y,
    width: rect.width / scale.x,
    height: rect.height / scale.y,
  };
}
