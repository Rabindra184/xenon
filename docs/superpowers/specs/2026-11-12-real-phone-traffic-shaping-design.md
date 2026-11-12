# Shaping a real Android phone's traffic (ENH-20, part 2)

Status: design, 2026-11-12. Follows part 1 (2.29.0, #586), which shapes an
Android emulator's traffic through its console.

## What this is for

Xenon Test's reference app is a React Native calling and messaging app. Its
tests need the moments the app breaks on a bad network: a message sent on a
slow link, an API call that takes seconds, call signalling that arrives late.
Part 1 gave emulators that. On a real Android phone, `4G`, `3G` and `Edge`
still only delay each Appium command; the app's own traffic is untouched.

**Decided with the user (2026-11-12):** the first version shapes the app's
HTTP and WebSocket traffic through a proxy. WebRTC call media (UDP) is out of
scope. Shaping it would need a Xenon VPN app on the phone (Android's
`VpnService`): a new signed APK and a one-time "Allow VPN" prompt per phone.
That can follow if call tests need it.

**Success looks like:** with `3G` set on a real Android phone (at session
start or with `xenon: setNetworkProfile`), an HTTP request the app makes takes
the profile's latency and bandwidth longer, as on the emulator; with `Normal`
it doesn't; after the session ends the phone's proxy setting is what it was
before, however the session ended, a crash included. Network capture keeps
working in the same session.

## What is shaped, and what isn't

Shaped: traffic that goes through Android's global HTTP proxy
(`settings global http_proxy`). That is what Android's own `HttpURLConnection`
and OkHttp use by default, so it covers React Native's `fetch`, its
WebSockets, and most native apps' HTTP and HTTPS.

Not shaped, and said so in the docs and in the command's answer:

- UDP: WebRTC audio and video, QUIC. (Chrome turns QUIC off behind a proxy.)
- DNS lookups.
- Apps that ignore the system proxy: Flutter apps, apps that pass
  `Proxy.NO_PROXY`, native sockets.
- Appium's own traffic: UiAutomator2 talks over `adb`, not through the
  phone's network.

## Approach

**Chosen: a throttling relay in front of the phone's proxy.** Xenon runs one
small TCP relay per shaped phone, on the host. The phone reaches it the way
it reaches the capture proxy today (`adb reverse`, so over the USB cable), and
its `http_proxy` points at it. The relay limits the bytes' rate and delays
them, in both directions, and never reads them: HTTPS stays encrypted end to
end, and no certificate is needed on the phone.

**Rejected: shaping inside the capture proxy.** It decrypts TLS, so every
shaped session would need Xenon's CA on the phone, and apps that pin their
certificate would fail. It also has no way to send its traffic on to another
proxy, so it can't sit behind a shaper either; the shaper sits in front.

**Rejected for now: a VPN app.** See above.

## Components

### `ShapingRelay` (`src/services/network/ShapingRelay.ts`)

A TCP server on a port leased from the `proxy` range (`PortAllocator`), one
per phone, bound to 127.0.0.1. For each connection the phone opens, it opens
one to its **target** and pipes the two, through the phone's shaper.

- **Target:** the capture proxy's port when the session captures traffic,
  else this server's `ForwardProxy`. The relay itself never parses HTTP.
- **The shaper** is per phone, shared by all its connections, so ten
  parallel downloads share the profile's bandwidth as on a real link:
  - a token bucket per direction, `downloadKbps` toward the phone and
    `uploadKbps` from it, refilled continuously, with a burst of 50 ms worth
    of bytes; chunks wait for tokens rather than being dropped;
  - a delay of half the profile's `latencyMs` on each direction's chunks, so a
    round trip gains about `latencyMs`, as part 1 measured on the emulator
    (55 ms to about 150 ms at `3G`);
  - order is kept within a connection.
- **Changing the profile** swaps the shaper's figures in place: `Normal`
  makes it unlimited with no delay; connections stay open.
- **Backpressure:** a connection's reader pauses while its queued bytes
  exceed 256 KB, so a fast server can't fill memory behind a slow profile.
- Figures are the existing `NETWORK_PROFILES` (4G 15000/7500 kbps and 20 ms,
  3G 2000/1000 and 100 ms, Edge 250/150 and 400 ms), so a profile means the
  same on an emulator and a real phone.

### `ForwardProxy` (`src/services/network/ForwardProxy.ts`)

A minimal HTTP forward proxy on a loopback port, for a phone that is shaped
without capture. It answers `CONNECT host:port` by opening the TCP connection
and replying `200 Connection Established`, and forwards plain-HTTP requests
in absolute form. No caching, no rewriting, no TLS. One per server (shared by
every relay), started when the first relay needs it and stopped when the last
one ends. A `CONNECT` it can't complete answers `502`.

### `PhoneProxy` (`src/services/network/PhoneProxy.ts`): one owner of the phone's proxy

Today `InterceptorService` reads, records, sets and restores the phone's
`http_proxy` itself (`pointPhoneAtProxy`, `putPhoneProxyBack`). With two
features pointing it, that becomes one owner per session, used by both:

- `pointAt(sessionId, device, localPort, purpose)`: sets up `adb reverse` for
  the port (the emulator alias `10.0.2.2` and the LAN fallback stay as
  capture has them), and points `http_proxy` there. The first call reads and
  records the phone's own setting as `previous`; later calls only change
  `set` and add the reverse port.
- `release(sessionId)`: removes every reverse port and puts `previous` back,
  once, under `withPhoneNetworkLock`.
- The ledger's `proxy` part keeps `previous` and `set`, and `reversePort`
  becomes `reversePorts: number[]` (a single `reversePort` written by an
  older release is still read). Boot clean-up and `restoreLeftovers` work as
  now: they undo the record, and a proxy pointing at this machine on a
  `proxy`-range port where nothing answers is cleared. The relay's ports come
  from that range, so a crashed relay's proxy is cleared by the same rule.

Capture moves onto `PhoneProxy` with no change in what it does.

### `NetworkConditioningService` changes

`setShape` (part 1's emulator path) gains the real-phone path. For a real
Android phone this server drives:

- **The first shaping profile** of the session (`4G`, `3G` or `Edge`, at the
  start or through the command) starts the phone's relay, targeting the
  capture proxy if the session captures, else the forward proxy, and points
  the phone's proxy at the relay.
- **Later profile changes** only change the relay's figures. `Normal` leaves
  the relay running unlimited rather than pointing the proxy back: apps cache
  the proxy and keep connections open, so a mid-test switch back would apply
  to some requests and not others.
- **`Offline`** turns the radios off as now; the relay stays.
- **The end of the session** (every ending, through `reset`, as now) stops
  the relay and releases the proxy.
- **Order at session start:** capture starts before the profile is applied
  (`applyPostSessionLogic` swaps its two steps, which today apply the
  profile first), so a relay started at the start targets the capture proxy
  directly. Capture is never started mid-session, so a relay never changes
  target.

`describe` and the command's answer say `appTraffic: 'shaped'` for a real
Android phone with a shaping profile, `'radios'` for `Offline`, `'none'` for
`Normal`, as for an emulator.

## Feature detection

`features.networkProfiles.appTraffic.androidDevice` becomes
`['Normal', '4G', '3G', 'Edge', 'Offline']`, and `features.networkProfiles`
gains `proxyShaped: ['androidDevice']`: the device kinds whose shaping covers
proxy-aware traffic only. Flag `real-phone-shaping` in `/sdk/version`. On a
hub the node does the shaping, so the node needs this release; an older node
answers as part 1 did (`appTraffic: 'none'` for a real phone).

## Errors

- **`adb reverse` fails and there is no LAN route:** the profile still
  delays commands, the answer says `appTraffic: 'none'`, and the server logs
  why once per phone. The session is never failed for it.
- **The relay can't lease a port:** the same.
- **The phone can't be reached at the end:** the record stays and the proxy
  is put back at the phone's next session or the next start, as capture's is.
- **The target refuses a connection:** the relay closes the phone's side.

## Testing

Unit, on loopback:

- the shaper's rate within 10% of the profile's for a 1 MB transfer each way,
  and its delay within 20 ms of half the latency per direction;
- shared bandwidth across two parallel connections;
- a profile change mid-transfer, and `Normal` passing bytes untimed;
- backpressure: a slow profile with a fast source doesn't buffer more than
  256 KB per connection;
- `ForwardProxy`: a `CONNECT` tunnel, a plain-HTTP request, a refused target;
- the relay targeting the forward proxy, and targeting a stand-in capture
  proxy.

Session-level, with a fake adb (`test/helpers/fake-adb.ts`):

- `3G` at start on a real phone: relay started, reverse set, proxy pointed,
  ledger written before the change;
- `3G` then `Normal` then `Edge`: one relay, one proxy change, figures
  swapped;
- capture and shaping together at session start: capture first, one proxy
  change, the relay targets the capture port, one restore;
- every session ending restores once; a crash restores at boot from the
  ledger, with `reversePorts`;
- an older ledger row with `reversePort` still restores;
- the command's answer and `features.networkProfiles`.

Live, on a real Android phone (the lab's S9+ when it is plugged in): a timed
request from the phone (`toybox nc`, as part 1) at `Normal`, `3G`, `Edge`,
`Normal`, and after the session; the same with capture on; and the phone's
`http_proxy` before and after.

## Out of scope

UDP and call media (a VPN app), iPhones (their proxy is set only by a
configuration profile or MDM), DNS, and shaping on a phone driven through a
remote adb server (`adbRemoteHost`): its `adb reverse` maps the phone's port to
the machine that runs that adb server, not to Xenon's, so the phone couldn't
reach the relay. Such a phone answers `appTraffic: 'none'`.
