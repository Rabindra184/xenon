import React from 'react';
import { Save, RotateCcw, RefreshCw, LucideIcon } from 'lucide-react';

interface ActionBarProps {
    onSave: () => void;
    onDiscard: () => void;
    onRestoreDefaults?: () => void;
    isSaving: boolean;
    isValidating?: boolean;
    saveLabel?: string;
    restoreLabel?: string;
}

export const ActionBar: React.FC<ActionBarProps> = ({
    onSave,
    onDiscard,
    onRestoreDefaults,
    isSaving,
    isValidating = false,
    saveLabel = 'Save Configuration',
    restoreLabel = 'Restore Defaults'
}) => (
    <div className="settings-footer">
        <div className="footer-left">
            {onRestoreDefaults && (
                <button
                    className="reset-to-defaults-btn"
                    onClick={onRestoreDefaults}
                    disabled={isSaving || isValidating}
                >
                    <RotateCcw size={16} />
                    {restoreLabel}
                </button>
            )}
        </div>
        <div className="footer-right">
            <button className="reset-btn" onClick={onDiscard} disabled={isSaving || isValidating}>
                Discard
            </button>
            <button className="save-btn" onClick={onSave} disabled={isSaving || isValidating}>
                {isSaving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
                {isSaving ? 'Saving...' : saveLabel}
            </button>
        </div>
    </div>
);

interface SettingSectionProps {
    title: string;
    description?: string;
    icon?: LucideIcon;
    children: React.ReactNode;
}

export const SettingSection: React.FC<SettingSectionProps> = ({ title, description, icon: Icon, children }) => (
    <div className="settings-section">
        <div className="section-header">
            <h3>
                {Icon && <Icon size={20} className="section-icon" style={{ color: 'var(--primary)' }} />}
                {title}
            </h3>
            {description && <p className="section-description">{description}</p>}
        </div>
        <div className="section-content">
            {children}
        </div>
    </div>
);
