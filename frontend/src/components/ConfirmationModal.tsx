import type { ReactNode } from 'react';
import ReactDOM from 'react-dom';
import './ConfirmationModal.css';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export default function ConfirmationModal({
  isOpen,
  title,
  description,
  confirmText = '確定',
  cancelText = '取消',
  onConfirm,
  onCancel,
  children,
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  // Prefer description if available for the main question text
  const mainMessage = description || title;

  return ReactDOM.createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-message">
      <div className="modal-container">
        <div className="modal-icon-container">
          <svg className="modal-warning-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 8.5V13" stroke="#FF7A38" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 16.75V17" stroke="#FF7A38" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10.268 4.116L2.3 17.5c-.884 1.5.198 3.5 1.968 3.5h15.464c1.77 0 2.852-2 1.968-3.5L13.732 4.116c-.885-1.5-3.047-1.5-3.932 0z" stroke="#FF7A38" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255, 122, 56, 0.15)"/>
          </svg>
        </div>
        
        <p id="modal-message" className="modal-message">{mainMessage}</p>
        
        {children}
        
        <div className="modal-actions">
          <button className="modal-btn cancel" type="button" onClick={onCancel}>
            {cancelText}
          </button>
          <button className="modal-btn confirm" type="button" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
