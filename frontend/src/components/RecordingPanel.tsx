import React from 'react'

interface RecordingPanelProps {
  isRecording: boolean
  onStart: () => Promise<void>
  onStop: () => Promise<void>
}

export default function RecordingPanel({ isRecording, onStart, onStop }: RecordingPanelProps) {
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
        disabled={loading}
      >
        {loading ? '...' : isRecording ? '⏹ 停止錄製' : '▶ 開始錄製'}
      </button>
    </div>
  )
}
