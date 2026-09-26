import * as React from 'react';
import XenonApiService from '../../../api-service';
import { useToast } from '../../ui/toast';
import { failed } from '../actionMessages';
import { AppsSection } from './AppsSection';
import { SwipeRow } from './SwipeRow';
import { swipePath, type SwipeDirection } from './swipe';
import { TextClipboardSection } from './TextClipboardSection';
import './actions.css';

interface Props {
  udid: string;
  platform: string;
  /** The name its Devices card shows, for every message. */
  deviceName: string;
  /** Device pixels, portrait (width < height), as device control computes them. */
  screenWidth: number;
  screenHeight: number;
}

/** Device control's Actions tab: Apps, then Text and clipboard, then Swipe. */
export function ActionsPanel({ udid, platform, deviceName, screenWidth, screenHeight }: Props) {
  const { toast } = useToast();

  const swipe = async (direction: SwipeDirection) => {
    const p = swipePath(direction, screenWidth, screenHeight);
    try {
      await XenonApiService.swipe(udid, p.startX, p.startY, p.endX, p.endY);
    } catch (err) {
      toast(failed(`swipe ${direction}`, err), 'error');
    }
  };

  return (
    <div className="actions-panel">
      <AppsSection udid={udid} platform={platform} deviceName={deviceName} />
      <TextClipboardSection udid={udid} platform={platform} />
      <SwipeRow onSwipe={swipe} />
    </div>
  );
}
