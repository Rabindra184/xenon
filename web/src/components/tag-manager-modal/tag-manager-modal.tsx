import React, { useState, useEffect, useRef } from 'react';
import './tag-manager-modal.css';
import { Tag as TagIcon, X, Plus } from 'lucide-react';
import { IDevice } from '../../interfaces/IDevice';
import XenonApiService from '../../api-service';
import { useToast } from '../ui/toast';
import { Modal } from '../ui/Modal';

interface TagManagerModalProps {
  device: IDevice;
  onClose: () => void;
  onUpdated: () => void;
}

const TagManagerModal: React.FC<TagManagerModalProps> = ({ device, onClose, onUpdated }) => {
  const { toast } = useToast();
  const [tags, setTags] = useState<string[]>(device.tags || []);
  const [inputValue, setInputValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleAddTag = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setInputValue('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTag();
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await XenonApiService.updateDeviceTags(device.udid, device.host, tags);
      onUpdated();
      onClose();
    } catch (err) {
      console.error('Failed to update tags', err);
      toast('Error saving tags. Please try again.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      width={520}
      title={
        <>
          <TagIcon size={16} className="title-icon" />
          Manage Device Tags
        </>
      }
      footer={
        <>
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-save" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Apply Changes'}
          </button>
        </>
      }
    >
      <div className="tag-modal-body">
        <div className="device-id-badge">
          <span className="label">Device:</span>
          <span className="value">{device.udid}</span>
        </div>

        <div className="tag-input-section">
          <label htmlFor="tag-input">Add New Tag</label>
          <div className="input-with-button">
            <input
              ref={inputRef}
              id="tag-input"
              type="text"
              placeholder="e.g. stable, team-a, ios-17"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="add-inline-btn"
              onClick={handleAddTag}
              disabled={!inputValue.trim()}
            >
              <Plus size={16} />
            </button>
          </div>
          <p className="input-hint">Press Enter to add multiple tags</p>
        </div>

        <div className="tags-display-section">
          <label>Current Tags</label>
          <div className="tags-list">
            {tags.length > 0 ? (
              tags.map((tag) => (
                <div key={tag} className="tag-pill-editable">
                  {tag}
                  <button className="remove-tag" onClick={() => handleRemoveTag(tag)}>
                    <X size={12} />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-tags">No tags assigned to this device.</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default TagManagerModal;
