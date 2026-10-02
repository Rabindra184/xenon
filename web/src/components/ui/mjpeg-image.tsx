import * as React from 'react';

type Props = React.ImgHTMLAttributes<HTMLImageElement>;

/**
 * An <img> showing an MJPEG stream, which closes the stream when it leaves
 * the page.
 *
 * A browser keeps loading a multipart MJPEG <img> after the element is
 * removed, until it is garbage collected. The server counts each open
 * connection as a viewer of the device, so a closed tile, or one remounted
 * by a reconnect, kept the preview and its hold on the phone running for
 * viewers that weren't there. Removing the src attribute aborts the load at
 * once, and unlike setting it to '' fires no error event, so the old
 * element's onError can't start another reconnect.
 */
export const MjpegImage = React.forwardRef<HTMLImageElement, Props>(
  function MjpegImage(props, forwardedRef) {
    const own = React.useRef<HTMLImageElement | null>(null);

    const setRef = React.useCallback(
      (img: HTMLImageElement | null) => {
        own.current = img;
        if (typeof forwardedRef === 'function') forwardedRef(img);
        else if (forwardedRef) forwardedRef.current = img;
      },
      [forwardedRef],
    );

    React.useEffect(() => {
      const img = own.current;
      return () => img?.removeAttribute('src');
    }, []);

    return <img ref={setRef} {...props} />;
  },
);
