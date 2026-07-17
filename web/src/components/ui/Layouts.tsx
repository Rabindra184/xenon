import React from 'react';
import { Save, RotateCcw, RefreshCw, LucideIcon } from 'lucide-react';
import { Button } from './button';

interface ActionBarProps {
  onSave: () => void;
  onDiscard: () => void;
  onRestoreDefaults?: () => void;
  isSaving: boolean;
  isValidating?: boolean;
  isDirty?: boolean;
  saveLabel?: string;
  restoreLabel?: string;
}

export const ActionBar: React.FC<ActionBarProps> = ({
  onSave,
  onDiscard,
  onRestoreDefaults,
  isSaving,
  isValidating = false,
  isDirty = false,
  saveLabel = 'Save Configuration',
  restoreLabel = 'Restore Defaults',
}) => (
  <div className="settings-footer">
    <div className="footer-left">
      {isDirty && (
        <span className="footer-dirty" aria-live="polite">
          <span className="footer-dirty__dot" />
          <span>Unsaved changes</span>
        </span>
      )}
      {isDirty && onRestoreDefaults && <span className="footer-divider" aria-hidden="true" />}
      {onRestoreDefaults && (
        <Button
          variant="danger"
          size="lg"
          onClick={onRestoreDefaults}
          disabled={isSaving || isValidating}
        >
          <RotateCcw size={16} />
          {restoreLabel}
        </Button>
      )}
    </div>
    <div className="footer-right">
      <Button variant="secondary" size="lg" onClick={onDiscard} disabled={isSaving || isValidating}>
        Discard
      </Button>
      <Button variant="primary" size="lg" onClick={onSave} disabled={isSaving || isValidating}>
        {isSaving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
        {isSaving ? 'Saving...' : saveLabel}
      </Button>
    </div>
  </div>
);

interface SettingSectionProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}

export const SettingSection: React.FC<SettingSectionProps> = ({
  title,
  description,
  icon: Icon,
  children,
}) => (
  <div className="settings-section">
    <div className="section-header">
      <h3>
        {Icon && <Icon size={20} className="section-icon" style={{ color: 'var(--green)' }} />}
        {title}
      </h3>
      {description && <p className="section-description">{description}</p>}
    </div>
    <div className="section-content">{children}</div>
  </div>
);
