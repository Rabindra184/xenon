import type { CSSProperties, ReactNode } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import ThemedImage from '@theme/ThemedImage';
import styles from './home.module.css';

type Props = {
  label: string;
  title: string;
  lede: string;
  points: ReactNode[];
  screen: 'device-control' | 'session';
  alt: string;
  // The picture's size in the file, and how much of its height to show. The
  // session page's file runs on into a chart that would be cut in half, so it
  // is shown down to the end of the chart above it.
  width: number;
  height: number;
  shownHeight?: number;
  reverse?: boolean;
};

// The screenshots sit below the first screen, so they load when the reader
// gets near them.
function Row({ label, title, lede, points, screen, alt, width, height, shownHeight, reverse }: Props): ReactNode {
  const sources = {
    light: useBaseUrl(`/img/screens/${screen}-light.png`),
    dark: useBaseUrl(`/img/screens/${screen}-dark.png`),
  };
  const frame: CSSProperties = { aspectRatio: `${width} / ${shownHeight ?? height}` };

  return (
    <div className={`${styles.row} ${reverse ? styles.rowReverse : ''}`}>
      <div className={styles.rowText}>
        <p className={styles.label}>{label}</p>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.sub}>{lede}</p>
        <ul className={styles.points}>
          {points.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      </div>
      <div className={styles.frame}>
        <div className={styles.crop} style={frame}>
          <ThemedImage
            className={styles.shot}
            sources={sources}
            alt={alt}
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </div>
  );
}

export default function FeatureRows(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.wrap}>
        <Row
          label="Live control"
          title="Any phone in the lab, in your browser."
          lede="A live preview you can tap, swipe and type into, whichever machine the phone is plugged into."
          points={[
            <>
              <strong>Live preview</strong> on every phone, with optional hardware H.264 on Android
            </>,
            <>
              <strong>Android logs</strong> streamed live, with filters
            </>,
            <>
              <strong>Install apps</strong> from the library, read the clipboard, take screenshots
            </>,
            <>
              <strong>Record several phones</strong> side by side, with marks and a proof bundle
            </>,
          ]}
          screen="device-control"
          alt="Xenon device control: a phone's live preview beside its Logs tab"
          width={2880}
          height={1800}
        />
        <Row
          reverse
          label="Test evidence"
          title="Every session explains how it ended."
          lede="Each session opens with its result and why, then everything you need to see what happened."
          points={[
            <>
              <strong>Video and screenshots</strong>, the device's logs and every command
            </>,
            <>
              <strong>CPU and memory</strong> charts for Android and iPhone
            </>,
            <>
              <strong>Sessions grouped by build</strong>, with pass rate, failures and durations
            </>,
            <>
              <strong>Network capture</strong> with mocks and HAR export (Android)
            </>,
          ]}
          screen="session"
          alt="A Xenon session page: its result, the selector that healed, and CPU and memory charts"
          width={2880}
          height={1800}
          shownHeight={1676}
        />
      </div>
    </section>
  );
}
