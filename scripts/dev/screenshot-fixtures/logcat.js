/**
 * Sample log lines for the device control screenshot's Logs tab: two minutes
 * of a made-up shop app's checkout on an Android phone. Every record has the
 * shape the logcat WebSocket sends, `{ ts, pid, tid, level, tag, message, pkg }`.
 *
 * About forty lines, mostly info and debug, with the payment's two failed
 * attempts (two errors) and what the app did about them (three warnings).
 */

const APP = 'com.example.shop';
const SYSTEM = 'system_server';
const APP_PID = 14233;
const SYSTEM_PID = 1782;

/** [seconds after the first line, level, tag, message] per line, oldest first. */
const LINES = [
  [
    0.0,
    'I',
    'ActivityTaskManager',
    'START u0 {cmp=com.example.shop/.cart.CartActivity} from uid 10312',
  ],
  [0.4, 'D', 'ShopCheckout', 'CartViewModel: 3 items, subtotal=145.50 USD'],
  [1.9, 'D', 'OkHttp', '--> GET https://api.example.com/v2/cart/c_91f2/quote'],
  [
    2.2,
    'D',
    'OkHttp',
    '<-- 200 https://api.example.com/v2/cart/c_91f2/quote (287ms, 1421-byte body)',
  ],
  [
    4.8,
    'I',
    'ActivityTaskManager',
    'START u0 {cmp=com.example.shop/.checkout.CheckoutActivity} from uid 10312',
  ],
  [5.1, 'D', 'ShopCheckout', 'CheckoutViewModel init cartId=c_91f2 items=3'],
  [5.3, 'D', 'ShopCheckout', 'loadSavedCards() -> 2 cards'],
  [
    5.7,
    'I',
    'ActivityTaskManager',
    'Displayed com.example.shop/.checkout.CheckoutActivity for user 0: +412ms',
  ],
  [
    6.0,
    'D',
    'chromium',
    '[INFO:CONSOLE(1)] "Payment sheet ready", source: https://pay.example.com/sheet.js (1)',
  ],
  [9.6, 'D', 'ShopCheckout', 'promo SPRING10 validated: discount=-14.55'],
  [10.1, 'D', 'OkHttp', '--> POST https://api.example.com/v2/promo/validate (38-byte body)'],
  [10.4, 'D', 'OkHttp', '<-- 200 https://api.example.com/v2/promo/validate (301ms, 96-byte body)'],
  [18.5, 'I', 'ShopCheckout', 'payment method selected: card_visa_4242'],
  [
    24.2,
    'D',
    'chromium',
    '[INFO:CONSOLE(1)] "3DS challenge not required", source: https://pay.example.com/sheet.js (1)',
  ],
  [41.0, 'I', 'ShopCheckout', 'Pay now tapped total=130.95 USD'],
  [41.1, 'D', 'OkHttp', '--> POST https://api.example.com/v2/payments (412-byte body)'],
  [43.2, 'E', 'ShopCheckout', 'payment attempt 1 of 3 failed: SocketTimeoutException: timeout'],
  [43.3, 'W', 'ShopCheckout', 'retrying payment in 1500ms idempotencyKey=pk_7c1e'],
  [44.8, 'D', 'OkHttp', '--> POST https://api.example.com/v2/payments (412-byte body)'],
  [
    46.3,
    'E',
    'ShopCheckout',
    'payment attempt 2 of 3 failed: HTTP 503 (payments-gateway unavailable)',
  ],
  [46.4, 'W', 'ShopCheckout', 'retrying payment in 3000ms idempotencyKey=pk_7c1e'],
  [49.5, 'D', 'OkHttp', '--> POST https://api.example.com/v2/payments (412-byte body)'],
  [50.3, 'D', 'OkHttp', '<-- 201 https://api.example.com/v2/payments (801ms, 214-byte body)'],
  [50.4, 'I', 'ShopCheckout', 'payment captured paymentId=pay_3f9a2c attempt=3'],
  [
    50.6,
    'W',
    'chromium',
    '[WARNING:CONSOLE(1)] "Slow payment: 9.3s from tap to capture", source: https://pay.example.com/sheet.js (1)',
  ],
  [
    50.9,
    'I',
    'ActivityTaskManager',
    'START u0 {cmp=com.example.shop/.order.OrderConfirmationActivity} from uid 10312',
  ],
  [51.1, 'D', 'ShopCheckout', 'OrderConfirmationViewModel orderId=o_55820'],
  [
    51.3,
    'I',
    'ActivityTaskManager',
    'Displayed com.example.shop/.order.OrderConfirmationActivity for user 0: +188ms',
  ],
  [51.8, 'D', 'OkHttp', '--> POST https://analytics.example.com/v1/events (233-byte body)'],
  [52.1, 'D', 'OkHttp', '<-- 202 https://analytics.example.com/v1/events (264ms, 0-byte body)'],
  [
    60.4,
    'D',
    'chromium',
    '[INFO:CONSOLE(1)] "Receipt rendered", source: https://pay.example.com/receipt.js (1)',
  ],
  [63.0, 'I', 'ShopCheckout', 'receipt email queued orderId=o_55820'],
  [63.2, 'D', 'OkHttp', '--> POST https://api.example.com/v2/orders/o_55820/receipt (0-byte body)'],
  [
    63.6,
    'D',
    'OkHttp',
    '<-- 202 https://api.example.com/v2/orders/o_55820/receipt (402ms, 0-byte body)',
  ],
  [78.9, 'D', 'ShopCheckout', 'CartRepository: cart c_91f2 cleared'],
  [
    91.5,
    'I',
    'ActivityTaskManager',
    'Displayed com.example.shop/.home.HomeActivity for user 0: +96ms',
  ],
  [92.2, 'D', 'OkHttp', '--> GET https://api.example.com/v2/recommendations?limit=12'],
  [
    92.7,
    'D',
    'OkHttp',
    '<-- 200 https://api.example.com/v2/recommendations?limit=12 (512ms, 9.8-kB body)',
  ],
  [
    104.3,
    'D',
    'chromium',
    '[INFO:CONSOLE(1)] "Session heartbeat", source: https://pay.example.com/sheet.js (1)',
  ],
  [116.8, 'D', 'ShopCheckout', 'HomeViewModel: refreshed 12 recommendations'],
];

/**
 * The records, the last one `endTs` (epoch ms) and the first about two
 * minutes before it. A line's thread id is its pid plus a fixed offset, so
 * the same input gives the same records every run.
 */
function logcatRecords(endTs) {
  const last = LINES[LINES.length - 1][0];
  const start = endTs - Math.round((last + 1.2) * 1000);
  return LINES.map(([offset, level, tag, message], i) => {
    const fromSystem = tag === 'ActivityTaskManager';
    const pid = fromSystem ? SYSTEM_PID : APP_PID;
    return {
      ts: start + Math.round(offset * 1000),
      pid,
      tid: fromSystem ? pid + 449 : pid + (i % 3 === 0 ? 0 : 27),
      level,
      tag,
      message,
      pkg: fromSystem ? SYSTEM : APP,
    };
  });
}

module.exports = { logcatRecords, LINES };
