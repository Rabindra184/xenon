import * as React from 'react';
import XenonApiService from '../../../api-service';
import type { PhoneRef } from '../../../lib/phone';
import { useToast } from '../../ui/toast';
import { failed } from '../actionMessages';
import { AppsSection } from './AppsSection';
import { SwipeRow } from './SwipeRow';
import { swipePath, type SwipeDirection } from './swipe';
import { TextClipboardSection } from './TextClipboardSection';
import './actions.css';

interface Props {
  phone: PhoneRef;
  platform: string;
  /** The name its Devices card shows, for every message. */
  deviceName: string;
  /** Device pixels, portrait (width < height), as device control computes them. */
  screenWidth: number;
  screenHeight: number;
}

/** Device control's Actions tab: Apps, then Text and clipboard, then Swipe. */
export function ActionsPanel({ phone, platform, deviceName, screenWidth, screenHeight }: Props) {
  const { toast } = useToast();

  const swipe = async (direction: SwipeDirection) => {
    const p = swipePath(direction, screenWidth, screenHeight);
    try {
      await XenonApiService.swipe(phone, p.startX, p.startY, p.endX, p.endY);
    } catch (err) {
      toast(failed(`swipe ${direction}`, err), 'error');
    }
  };

  return (
    <div className="actions-panel">
      <AppsSection phone={phone} platform={platform} deviceName={deviceName} />
      <TextClipboardSection phone={phone} platform={platform} />
      <SwipeRow onSwipe={swipe} />
    </div>
  );
}
