import React from 'react';
import { Camera, Download, ExternalLink } from 'lucide-react';
import XenonApiService from '../../api-service';

interface ScreenshotEntry {
  id: string;
  screenshot: string;
  command_name: string | null;
  title: string;
  createdAt: string;
}

interface ScreenshotsViewProps {
  logs: any[];
}

const ScreenshotsView: React.FC<ScreenshotsViewProps> = ({ logs }) => {
  const screenshots: ScreenshotEntry[] = logs
    .filter((l) => l.screenshot)
    .map((l) => ({
      id: l.id,
      screenshot: l.screenshot,
      command_name: l.command_name,
      title: l.title,
      createdAt: l.createdAt,
    }));

  if (screenshots.length === 0) {
    return (
      <div className="profiling-empty">
        <Camera size={48} className="empty-icon" />
        <h3>No Screenshots Captured</h3>
        <p>Enable "Screenshot on Failure" or specific command screenshots to see them here.</p>
      </div>
    );
  }

  return (
    <div className="screenshots-view animate-fade-in">
      <div className="screenshots-grid">
        {screenshots.map((s) => (
          <div key={s.id} className="screenshot-card">
            <div
              className="screenshot-img-wrapper"
              onClick={() => window.open(XenonApiService.getAssetUrl(s.screenshot), '_blank')}
            >
              <img
                src={XenonApiService.getAssetUrl(s.screenshot)}
                alt={s.title}
                className="device-screenshot-img"
              />
              <div className="screenshot-overlay">
                <ExternalLink size={24} />
              </div>
            </div>
            <div className="screenshot-info">
              <div className="screenshot-command">{s.title || s.command_name}</div>
              <div className="screenshot-time">{new Date(s.createdAt).toLocaleTimeString()}</div>
              <a
                href={XenonApiService.getAssetUrl(s.screenshot)}
                download={`screenshot_${s.id}.png`}
                className="screenshot-download-link"
                onClick={(e) => e.stopPropagation()}
              >
                <Download size={14} />
                Download
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ScreenshotsView;
