import React from 'react'

interface RecordingPanelProps {
  isRecording: boolean
  bigScreenEditing?: boolean
  onStart: () => Promise<void>
  onStop: () => Promise<void>
}

export default function RecordingPanel({ isRecording, bigScreenEditing, onStart, onStop }: RecordingPanelProps) {
  const [loading, setLoading] = React.useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      if (isRecording) {
        await onStop()
      } else {
        await onStart()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="recording-panel">
      {isRecording && (
        <span className="recording-indicator">● 錄製中</span>
      )}
      <button
        className={`control-btn ${isRecording ? 'recording-stop' : 'recording-start'}`}
        onClick={handleClick}
        disabled={loading || bigScreenEditing}
        title={bigScreenEditing ? '大屏編輯模式中，無法開始錄製' : undefined}
      >
        {loading ? '...' : isRecording ? '⏹ 停止錄製' : '▶ 開始錄製'}
      </button>
    </div>
  )
}
